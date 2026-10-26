# KẾ HOẠCH TRIỂN KHAI & KIẾN TRÚC KỸ THUẬT: MINDX AUTOMATION BOT (v2.1 - FULL MASTER PLAN)

> **Phiên bản:** 2.1 (Bản đầy đủ 8 Giai đoạn: Giai đoạn 0 $\rightarrow$ Giai đoạn 7 — Không lược bỏ tính năng)
>
> **Kiến trúc:** Local Web Application (Next.js App Router + TypeScript + Node.js, chạy trên `127.0.0.1:3000`)
>
> **Automation Engine:** Playwright (Persistent Context + Sequential Task Queue + Network Interception + Read-after-Write Verification)
>
> **AI Engine:** Google Gemini (`gemini-3.5-flash-lite`) với Structured Outputs (JSON Schema) + Evidence-Based Grading
>
> **Lưu trữ Cục bộ:** SQLite (`better-sqlite3` - `data/mindx_bot.db`) lưu trạng thái/nháp/hash + JSON (`data/config/`) lưu Giáo trình, Barem, Quick Tags, Mẫu Zalo.

---

## PHẦN 0: MỤC TIÊU DỰ ÁN, LUỒNG NGHIỆP VỤ & NGUYÊN TẮC AN TOÀN (PROJECT GOAL & AI CONTEXT)

> **Dành cho AI Coding Agent:** Đọc kỹ phần này trước khi viết bất kỳ dòng code nào để hiểu rõ bức tranh tổng thể, mục tiêu nghiệp vụ, trải nghiệm người dùng và 6 nguyên tắc an toàn dữ liệu bắt buộc phải tuân thủ.

### 1. Bài toán & Mục tiêu cốt lõi (Core Project Goal)

**MindX Automation Bot** là trợ lý tự động hóa toàn diện giúp giáo viên tại MindX giải quyết 4 công việc tốn thời gian nhất sau mỗi buổi học và cuối khóa học (kèm hệ thống quản lý giáo trình/barem ngay trên giao diện Web):

1. **Chuẩn bị & Tự động lưu Nhận xét sau buổi học + Thông báo Zalo (Luồng dọc đầu tiên):**
   * Giáo viên mở Web App trên máy tính, chọn Lớp và Buổi học.
   * Ứng dụng tự động đăng nhập (lấy tài khoản/mật khẩu từ `.env.local`), đọc lịch dạy thực tế từ hệ thống **Teaching** và danh sách học viên từ hệ thống **LMS** (xử lý đầy đủ phân trang).
   * Ứng dụng khóa định danh theo `classId`, `sessionId`, `studentId`, tự động lọc ra các học viên **đang theo học (`Active`)** và **có điểm danh đi học (`Có mặt`)** trong buổi đó để hiển thị khung nhận xét.
   * Giáo viên chọn **Nội dung bài học** (được lưu sẵn trong Web App theo từng khóa), bấm chọn nhanh các thẻ đánh giá **Quick Tags** (Thái độ, Tiếp thu, Thao tác) và nhập **ghi chú nhanh** về từng học viên.
   * Dựa trên thông tin đó, AI (`gemini-3.5-flash-lite`) soạn nhận xét hàng loạt cho toàn bộ học viên đi học. Mỗi nhận xét bắt buộc có **3 phần**:
     1. **Điểm mạnh** (`strengths`)
     2. **Điều cần cải thiện** (`improvements`)
     3. **Hướng rèn luyện** (`actionPlan`)
   * Đồng thời, ứng dụng tự động chuẩn bị một **Thông báo chung cho cả lớp** theo mẫu Zalo đã định sẵn.
   * Giáo viên xem lại trên giao diện Web App, chỉnh sửa nếu cần, rồi bấm **Chấp nhận / Duyệt**:
     * Ứng dụng tự động điều khiển trình duyệt **điền, bấm Lưu nhận xét vào LMS và đọc lại để đối chiếu (Read-after-Write)**.
     * Riêng phần thông báo chung và nhận xét gửi Zalo, ứng dụng cung cấp nút **Copy** để giáo viên dán nhanh vào nhóm Zalo.

2. **Cào dữ liệu điểm ra bảng để Giáo viên báo cáo (Luồng đọc mở rộng):**
   * Ứng dụng tự động quét toàn bộ dữ liệu điểm các buổi học của cả lớp qua tất cả các trang trên LMS, phân biệt rõ 4 trạng thái (`Đã chấm`, `Chưa chấm`, `Chưa nộp`, `Điểm 0`), tổng hợp thành bảng trực quan trên Web App và hỗ trợ xuất ra file Excel (`.xlsx` / `.csv`) hoặc Copy trực tiếp vào Google Sheets.

3. **Tự động Tải & Chấm bài tập sau các buổi học theo Barem điểm (Luồng Top-Down: LMS $\rightarrow$ Máy):**
   * Lọc toàn bộ học viên **có bài nộp hợp lệ** trên LMS (độc lập với điểm danh buổi học, tránh bỏ sót học sinh nghỉ học nhưng vẫn nộp bài ở nhà).
   * Học sinh nộp bài tập trên LMS dưới dạng file theo từng bộ môn:
     * **Python / Data / Desktop App:** `.py`, `.ipynb` (Jupyter Notebook), PyQt6 (`.ui`, `.qss`)...
     * **Web:** `.html`, `.css`, `.js`, `.zip`...
     * **Game / Lập trình kéo thả:** GameMaker (`.yyz`, `.gml`, `.yy`), Scratch (`.sb3`), hoặc file nén `.zip`, hình ảnh (`.png`, `.jpg`), tài liệu (`.pdf`)...
   * Bot chủ động **tải file bài làm từ LMS về máy**, khóa cứng chuỗi liên kết `submissionId → studentId → localFilePath → fileHash` ngay lúc tải về để triệt tiêu 100% rủi ro ghép nhầm bài.
   * Bộ đọc file (File Parser) giải nén an toàn và đọc mã nguồn/cấu trúc dự án. AI (`gemini-3.5-flash-lite`) dựa vào **Câu hỏi bài tập**, **Kiến thức buổi học** và **Barem điểm (Rubric)** để **đề xuất điểm thành phần kèm trích dẫn bằng chứng code**. Code TypeScript tự cộng tổng điểm (thang 100).
   * Giáo viên kiểm tra lại điểm và nhận xét trên Web App, bấm Duyệt $\rightarrow$ Bot tự động mở Modal chấm bài trên LMS, điền điểm số, điền nhận xét, bấm **Lưu** và đối chiếu kết quả.

4. **Tự động Upload Bài cuối khóa (SPCK) & Ghi nhận xét cuối khóa (Luồng Bottom-Up: Máy $\rightarrow$ LMS):**
   * Giáo viên chuẩn bị một thư mục cho cả lớp trên máy tính, bên trong có các **thư mục con đặt theo tên từng học viên** (chứa ảnh thumbnail, các ảnh chụp màn hình sản phẩm, file đính kèm dự án/slide và file `links.txt` chứa link Youtube/link sản phẩm).
   * Ứng dụng quét thư mục lớp, gợi ý ghép nối tên thư mục với `studentId` trên LMS qua **Bảng Ghép nối (Mapping Table)** (cảnh báo nếu trùng tên hoặc khớp $< 100\%$ để giáo viên xác nhận), kiểm tra gói file hợp lệ và dùng AI soạn **Nhận xét tổng kết cuối khóa (`Bình luận của giáo viên *`)**.
   * Khi giáo viên duyệt, Bot kiểm tra chống trùng lặp trên LMS, mở form Sản Phẩm Học Viên của từng `studentId`, điền Tiêu đề ($\le 100$ ký tự), thêm Youtube URL, thay ảnh Thumbnail, tải hình ảnh sản phẩm, tải tài liệu đính kèm, thêm đường dẫn liên quan, điền Bình luận của giáo viên, bấm **Lưu** và đối chiếu kết quả.

### 2. Sơ đồ Luồng Hoạt động Tổng thể (End-to-End Workflow)

```
[Giáo viên mở Web App (http://127.0.0.1:3000) qua file start-bot.bat / .command]
       │
       ├──► 0. KHẢO SÁT & ĐỒNG BỘ NỀN TẢNG (Playwright Queue + SQLite State DB)
       │       ├─ Tự động đăng nhập Teaching & LMS từ .env.local (lưu Persistent Profile)
       │       └─ Khóa định danh chuẩn: classId, sessionId, studentId, submissionId
       │
       ├──► 1. LUỒNG DỌC 1: NHẬN XÉT BUỔI HỌC & ZALO
       │       ├─ Cào lịch dạy thực tế (Teaching) + Học viên Active & Điểm danh (LMS)
       │       ├─ GV chọn Nội dung bài học (từ Syllabus) + Chọn Quick Tags 1 chạm + Ghi chú
       │       ├─ Gemini 3.5 Flash Lite sinh nhận xét 3 phần (Ẩn danh + Cấm bịa ngoài dữ liệu)
       │       ├─ Tự động lưu nháp vào SQLite -> GV xem lại, sửa & bấm Duyệt (lưu contentHash)
       │       └─ Bot điền & Lưu lên LMS -> Đọc lại đối chiếu (VERIFIED) | GV bấm Copy gửi Zalo
       │
       ├──► 2. LUỒNG 2: CÀO BẢNG ĐIỂM BÁO CÁO (ĐỌC MỞ RỘNG)
       │       ├─ Quét toàn bộ các trang điểm số của lớp trên tab Chấm bài
       │       ├─ Phân biệt rõ: Đã chấm / Chưa chấm / Chưa nộp / Điểm 0
       │       └─ Hiển thị bảng tổng hợp & Xuất file Excel (.xlsx, .csv) / Copy Google Sheets
       │
       ├──► 3. LUỒNG 3: TỰ CHẤM BÀI TẬP (TOP-DOWN: LMS ──► MÁY)
       │       ├─ Lọc mọi bài nộp hợp lệ -> Tải file về máy kèm khóa cứng: submissionId -> studentId -> path -> hash
       │       ├─ File Parser đọc code/cấu trúc (.py, .ipynb, PyQt6, Web, .zip, .sb3, .yyz/.gml, ảnh/PDF)
       │       ├─ Gemini đề xuất điểm từng tiêu chí kèm bằng chứng code -> Code TS tự cộng tổng điểm
       │       └─ GV duyệt -> Bot điền vào Modal Chấm bài trên LMS, bấm Lưu & Đọc lại đối chiếu
       │
       ├──► 4. LUỒNG 4: AUTO UPLOAD SẢN PHẨM CUỐI KHÓA (BOTTOM-UP: MÁY ──► LMS)
       │       ├─ Quét thư mục SPCK trên ổ cứng -> Bảng ghép nối thư mục học sinh với studentId
       │       ├─ Phân loại Thumbnail, Ảnh SP, File đính kèm, links.txt & Kiểm tra giới hạn LMS
       │       ├─ Gemini soạn "Bình luận của giáo viên" tổng kết khóa học -> GV duyệt
       │       └─ Bot kiểm tra chống trùng -> Upload toàn bộ file, link (+ Thêm), nhận xét -> Lưu & Đối chiếu
       │
       └──► 5. QUẢN TRỊ GIÁO TRÌNH & THEO DÕI TRỰC TIẾP (UI MÀN HÌNH 4 & LIVE LOG DRAWER)
               ├─ Màn hình quản lý Syllabus, Câu hỏi bài tập, Barem điểm & Mẫu Zalo ngay trên Web
               └─ Thanh Live Automation Log hiển thị tiến trình thời gian thực + Nút Stop khẩn cấp
```

### 3. Sáu Nguyên tắc An toàn Kỹ thuật & Sư phạm (Bắt buộc tuân thủ)

1. **Định danh bằng ID, không định danh bằng Tên:** Mọi thao tác đọc/ghi nội bộ với LMS bắt buộc khóa theo `classId`, `sessionId`, `studentId`, `submissionId`. Tên học viên chỉ dùng để hiển thị giao diện.
2. **Tách biệt điều kiện nghiệp vụ:**
   * *Nhận xét buổi học:* Lọc theo học viên `Active` + Điểm danh `Có mặt`.
   * *Chấm bài tập:* Lọc theo bài nộp hợp lệ trên hệ thống (`submissionId`), độc lập với điểm danh.
3. **Xác minh sau khi lưu (Read-after-Write Verification) & Chống ghi lặp (Idempotency):**
   * Không coi sự kiện đóng Modal là lưu thành công. Bắt buộc kiểm tra HTTP Response (`200/201`) và đọc ngược lại DOM để đối chiếu khớp với bản đã duyệt (`VERIFIED`).
   * Trước khi bấm `+ Thêm sản phẩm học viên` hoặc `+ Thêm` link/file, phải kiểm tra dữ liệu hiện có trên DOM để cập nhật thay vì tạo trùng.
4. **Hàng đợi đơn luồng (Sequential Playwright Queue) & Lưu vết SQLite:**
   * Tại một thời điểm chỉ có duy nhất 1 tác vụ điều khiển trang Playwright.
   * Trạng thái tác vụ (`PENDING → RUNNING → WAITING_APPROVAL → SAVING → VERIFIED / FAILED`) và bản nháp được lưu tức thì vào SQLite kèm `contentHash`. Nếu giáo viên sửa nội dung sau khi duyệt, trạng thái tự động quay về `WAITING_APPROVAL`.
5. **Quy tắc Sư phạm & Bằng chứng cho AI (Evidence-Based AI):**
   * **Cấm bịa đặt:** Không có Quick Tags và không có ghi chú thì báo trạng thái `Chưa đủ thông tin`, không tự suy diễn thái độ hay kỹ năng thuyết trình.
   * **Chấm điểm có bằng chứng & Cộng điểm bằng Code:** AI chỉ trả về điểm từng tiêu chí (`earnedPoints`, `maxPoints`, `evidenceSnippet`, `reason`). Code TypeScript tự kiểm tra giới hạn và cộng tổng điểm.
   * **Tách biệt lỗi đọc file (`PARSE_ERROR`):** File hỏng/không đọc được phải gắn cờ báo giáo viên kiểm tra thủ công, không tự chấm 0 điểm hay tự chọn yêu cầu làm lại.
   * **Chống Prompt Injection & Ẩn danh:** Thay tên học sinh bằng mã `STUDENT_01` khi gọi Gemini; bọc code bài nộp trong thẻ cách ly dữ liệu.
6. **Bảo mật Cục bộ (Local Security):**
   * Web server chỉ lắng nghe trên `127.0.0.1`. Giới hạn thư mục được phép đọc trên ổ cứng. Không trả mật khẩu/API key ra Frontend. Loại trừ `.env.local`, `.playwright-profile/`, `temp_submissions/` và `data/mindx_bot.db` khỏi Git.

---

## PHẦN 1: PHÂN TÍCH CHUYÊN SÂU GIAO DIỆN LMS (TỪ 4 HÌNH ẢNH THỰC TẾ)

Qua 4 ảnh chụp màn hình thực tế của hệ thống **MindX LMS**, dưới đây là các đặc điểm DOM/UI quan trọng mà bộ máy Playwright cần xử lý chính xác (và sẽ được xác minh thêm ở Giai đoạn 0):

1. **Cấu trúc Drawer Lớp học & Thanh Tab ngang (Hình 3 & 4):**
   * Khi chọn một lớp (ví dụ `VT-C4K-PTA13` ở trạng thái `Running`) từ bảng danh sách bên trái, hệ thống mở một **Slide-over Drawer** chiếm 2/3 màn hình bên phải.
   * Thanh điều hướng trong Drawer gồm các tab: `Thông tin chung`, `Lịch học`, `Bài tập về nhà`, `Chấm bài`, `Nhập học`, `Bảng tin lớp học`, `Học viên`, `Giảng viên`... (có nút mũi tên `>` để cuộn ngang nếu tràn màn hình).
   * **Xử lý thông báo `Forbidden` màu đỏ ở góc dưới phải (Hình 4):** Không đánh đồng mọi toast `Forbidden` trên UI là lỗi tác vụ (vì tài khoản giảng viên thường bị giới hạn quyền với một số API CRM phụ chạy nền). Playwright sẽ bắt lỗi dựa trên **HTTP Status của đúng API nghiệp vụ đang thực thi** (`401/403/500` thì dừng tác vụ và báo lỗi rõ), đồng thời chỉ đóng hộp thoại toast phụ khi nó che khuất nút bấm.

2. **Tab `Học viên`, Phân trang & Bộ lọc Học viên Đang học (Hình 4):**
   * Bảng danh sách học viên có bộ chọn phân trang ở góc dưới: `Số dòng mỗi trang: 100` kèm chỉ số trang (`1-7 trong 7`). Bot phải vừa đặt hiển thị tối đa, vừa duyệt qua các trang (nếu tổng số dòng $> 100$) và đối chiếu tổng số bản ghi đọc được với tổng số ghi trên LMS.
   * Cột **`Trạng thái`** có nút gạt (Switch/Toggle):
     * **Màu xanh (`Active`):** Học viên đang theo học bình thường (VD: *Nguyễn Quỳnh Nguyên, Trần Nhật Minh, PHẠM THIỆN HOÀNG KHANG*).
     * **Màu xám (`Inactive`) kèm dấu `✕` đỏ ở cột Hoàn thành:** Học viên đã nghỉ/bảo lưu/chuyển lớp (VD: *Trần Minh Triết, Đồng Thị Bảo Hà*).

3. **Tab `Chấm bài` & Modal Chấm điểm Bài tập (Hình 3):**
   * Giao diện chia theo cột từng buổi (`Homework 2 - Làm quen với...`), hiển thị trạng thái `Đã chấm(1/1)`, điểm số `90/100` và nút `Chỉnh sửa` (hoặc nút chấm bài với bài chưa chấm).
   * Khi mở Modal chấm bài (VD: `VT-C4K-PTA13-Bài 2-PHẠM THIỆN HOÀNG KHANG-Bài thực hành 1`):
     * Hiển thị trạng thái nộp: `• Nộp đúng giờ`.
     * Mục **`Bài nộp`**: Chứa tên file đính kèm (VD: `1788605566199-baitapvenha.py`) và **nút icon Download** bên cạnh. Bot dùng `page.waitForEvent('download')` khi click vào icon này để tải file và gắn chặt với `submissionId` + `studentId`.
     * Hai lựa chọn Radio: `Chấm điểm` (mặc định) và `Yêu cầu học sinh làm lại bài tập`.
     * Ô **`Điểm số`**: Input nhập số nguyên (thang điểm 100, VD: `90`).
     * Ô **`Nhận xét`**: Là một **Rich Text Editor** (có thanh công cụ `B`, `I`, `U`, căn lề) với placeholder `Nhập nhận xét`.
     * Nút hành động: `Thoát` và `Lưu`.

4. **Form Upload Sản Phẩm Cuối Khóa - SPCK (Hình 1 & 2):**
   * Mỗi học viên có khung `Sản Phẩm Học Viên 01` (trạng thái `Pending #1`) hoặc nút `+ Thêm sản phẩm học viên` ở dưới cùng.
   * Các trường cần điền tự động từ thư mục máy tính của giáo viên:
     * `Tiêu đề *`: Tối đa 100 ký tự (VD: `SPCK Nguyên`, hiển thị bộ đếm `11/100`).
     * `Youtube Video (Youtube URL)`: Điền link + **Bắt buộc click nút `+ Thêm`** (tối đa 5 videos).
     * `Ảnh thumbnail *`: Click nút `+ Thay ảnh` $\rightarrow$ nạp ảnh tỷ lệ 16:9.
     * `Tải hình ảnh lên`: Vùng kéo thả màu xanh (`Only images are accepted`, tối đa 10 ảnh).
     * `Tài liệu đính kèm`: Vùng kéo thả màu cam (nhận nhiều định dạng file `.py`, `.zip`, `.sb3`, `.yyz`, `.pptx`..., tối đa 10 files).
     * `Đường dẫn liên quan (Link)`: Điền `Đặt tên đường dẫn` + `Nhập đường dẫn` + **Bắt buộc click nút `+ Thêm`** (tối đa 5 links).
     * `Bình luận của giáo viên*`: Nhận xét tổng kết cuối khóa.
     * Cuối cùng bấm nút `Lưu` (màu xanh góc phải dưới) và đối chiếu kết quả.

---

## PHẦN 2: KIẾN TRÚC HỆ THỐNG & CẤU TRÚC THƯ MỤC ĐẦY ĐỦ

### 1. Sơ đồ Kiến trúc Kỹ thuật (Next.js Local Full-Stack)

* **Frontend (Next.js Client Components + TailwindCSS + shadcn/ui):**
  * Chạy cục bộ tại `http://127.0.0.1:3000`.
  * Giao diện chia làm **4 Màn hình (Workspaces) chính** + **1 Thanh Live Automation Log Drawer**:
    1. **Màn hình 1 (`/session-comments`):** Nhận xét sau buổi học (Quick Tags + AI 3 phần) & Thông báo Zalo.
    2. **Màn hình 2 (`/homework-grader`):** Bảng điểm tổng hợp (Xuất Excel/Copy) & Tự chấm bài tập theo Barem.
    3. **Màn hình 3 (`/final-project`):** Quét thư mục, Ghép nối `studentId` & Auto Upload SPCK.
    4. **Màn hình 4 (`/syllabus-config`):** Quản lý Kho Nội dung bài học (Syllabus), Câu hỏi & Barem chấm điểm, Quick Tags và Mẫu Zalo trực tiếp trên giao diện Web.
    5. **Live Automation Log / Status Drawer:** Hiển thị tiến trình Playwright thời gian thực qua Server-Sent Events (SSE) kèm nút **Dừng khẩn cấp (Stop Bot)**.
* **Backend (Next.js Node.js API Routes + Sequential Queue):**
  * Điều phối **Playwright Singleton Manager** qua **Hàng đợi đơn luồng (`TaskQueue`)**.
  * Điều khiển **Multi-Subject File Parser Engine** đọc mã nguồn bài tập đa môn.
  * Giao tiếp với **Gemini API (`gemini-3.5-flash-lite`)** kèm lớp kiểm toán dữ liệu (Sanitizer & Score Auditor).
* **Local Storage (SQLite + JSON Config):**
  * **SQLite (`data/mindx_bot.db`):** Lưu trạng thái tác vụ, bản nháp nhận xét, kết quả chấm điểm, mã băm (`contentHash`, `fileHash`) và nhật ký chạy bot (`job_logs`).
  * **JSON Config (`data/config/`):** Lưu Giáo trình các khóa, Barem chấm điểm, Quick Tags và Mẫu thông báo Zalo.

### 2. Cấu trúc Thư mục Dự án (`mindx-automation-bot`)

```text
mindx-automation-bot/
├── .env.local                      # Lưu LMS_URL, TEACHING_URL, USERNAME, PASSWORD, GEMINI_API_KEY
├── .env.example                    # File mẫu cấu hình biến môi trường
├── start-bot.bat                   # File click đúp chạy nhanh trên Windows
├── start-bot.command               # File click đúp chạy nhanh trên macOS
├── MINDX_AUTOMATION_PLAN.md        # Tài liệu kế hoạch & theo dõi tiến độ gốc
├── .playwright-profile/            # Lưu Cookie/Session trình duyệt tự động (Cấm commit)
├── temp_submissions/               # Thư mục tạm chứa bài tập tải về từ LMS kèm manifest ID
├── scripts/
│   └── recon.ts                    # Kịch bản khảo sát thực tế DOM/API của Teaching & LMS (Giai đoạn 0)
├── data/
│   ├── mindx_bot.db                # SQLite Database lưu trạng thái tác vụ, nháp, hash, log
│   └── config/                     # Kho cấu hình JSON (có thể sửa qua UI Màn hình 4)
│       ├── courses_syllabus.json   # Nội dung bài học các khóa (PTA/PTB/PTI, JSB/JSA/JSI, SB/SA/SI, GB/GA/GI, ROB, CSI)
│       ├── grading_rubrics.json    # Câu hỏi bài tập & Barem chấm điểm theo từng môn/buổi
│       ├── quick_tags.json         # Bộ thẻ đánh giá nhanh 1 chạm cho giáo viên
│       └── zalo_templates.json     # Mẫu thông báo tổng kết gửi nhóm Zalo
├── src/
│   ├── app/                        # Giao diện & API Routes của Next.js
│   │   ├── page.tsx                # Dashboard tổng quan
│   │   ├── session-comments/       # Màn hình 1: Nhận xét sau buổi học & Zalo
│   │   ├── homework-grader/        # Màn hình 2: Tự chấm bài tập & Xuất bảng điểm
│   │   ├── final-project/          # Màn hình 3: Quét thư mục, Ghép ID & Upload SPCK
│   │   ├── syllabus-config/        # Màn hình 4: Quản lý Nội dung bài học, Barem, Quick Tags & Mẫu Zalo
│   │   └── api/
│   │       ├── automation/         # API điều khiển Playwright Queue (sync, comment, grade, spck, stop)
│   │       ├── ai/                 # API gọi Gemini 3.5 Flash Lite
│   │       ├── config/             # API đọc/ghi Giáo trình, Barem, Mẫu Zalo từ UI Màn hình 4
│   │       └── local-files/        # API quét thư mục SPCK và đọc file bài tập an toàn
│   ├── components/
│   │   └── live-log-drawer.tsx     # Thanh Live Automation Log / Status Drawer + Nút Stop khẩn cấp
│   ├── lib/
│   │   ├── config.ts               # Đọc biến môi trường & cấu hình bảo mật cục bộ
│   │   ├── db/
│   │   │   ├── sqlite.ts           # Kết nối better-sqlite3 & khởi tạo bảng
│   │   │   └── json-config.ts      # Đọc/ghi các file JSON cấu hình & Seed Data
│   │   ├── queue/
│   │   │   └── task-queue.ts       # Hàng đợi đơn luồng điều phối Playwright & phát sự kiện SSE Log
│   │   ├── playwright/
│   │   │   ├── browser-manager.ts  # Quản lý Persistent Browser & Auto-Login
│   │   │   ├── selectors.ts        # Tập trung toàn bộ CSS/XPath Selectors của LMS & Teaching
│   │   │   ├── lms-helpers.ts      # Xử lý phân trang, Drawer, Network verification & Toast
│   │   │   ├── sync-class.ts       # Cào lịch dạy, học viên Active & điểm danh theo ID
│   │   │   ├── save-comments.ts    # Điền nhận xét buổi học & đọc lại đối chiếu
│   │   │   ├── scrape-scores.ts    # Cào bảng điểm đa trang toàn khóa
│   │   │   ├── grade-worker.ts     # Tải bài tập kèm ID, điền điểm/nhận xét Rich Text & đối chiếu
│   │   │   └── spck-uploader.ts    # Kiểm tra chống trùng, upload ảnh/file/link SPCK & đối chiếu
│   │   ├── file-parsers/
│   │   │   ├── index.ts            # Điều phối bộ đọc file đa môn & bắt lỗi PARSE_ERROR
│   │   │   ├── code-reader.ts      # Đọc .py, .ipynb (Jupyter), .ui/.qss (PyQt6), .html, .css, .js
│   │   │   ├── archive-reader.ts   # Giải nén .zip an toàn (chống Zip Bomb, giới hạn dung lượng/độ sâu)
│   │   │   ├── game-reader.ts      # Đọc file Scratch (.sb3 -> project.json) & GameMaker (.yyz, .gml, .yy)
│   │   │   └── media-reader.ts     # Chuyển đổi ảnh (.png, .jpg) & tài liệu (.pdf) sang Multimodal input
│   │   ├── gemini/
│   │   │   ├── client.ts           # Khởi tạo Gemini 3.5 Flash Lite, Ẩn danh học sinh & Chống Prompt Injection
│   │   │   ├── schemas.ts          # Định nghĩa JSON Schema đầu ra
│   │   │   ├── score-auditor.ts    # Kiểm tra điểm thành phần & Tự cộng tổng điểm bằng code TypeScript
│   │   │   └── prompts.ts          # Prompt chuyên biệt cho Nhận xét, Chấm bài theo Barem, SPCK
│   │   └── utils/
│   │       └── vietnamese-match.ts # Chuẩn hóa tiếng Việt để gợi ý ghép tên thư mục với studentId
```

---

## PHẦN 3: GIẢI PHÁP XỬ LÝ CÁC BÀI TOÁN KỸ THUẬT ĐẶC THÙ

### 1. Bộ Đọc & Chấm File Bài tập Đa Môn Học (Multi-Subject File Parser Engine)

Khi Playwright tải file bài nộp từ LMS về máy (kèm khóa cứng `submissionId → studentId → localFilePath → fileHash`), hệ thống phân tích tĩnh theo từng môn học:

* **Môn Python & Ứng dụng Desktop (`.py`, `.ipynb`, `.ui`, `.qss`):**
  * Với `.py`: Đọc mã nguồn UTF-8, đếm dòng code, kiểm tra cấu trúc hàm/lớp.
  * Với `.ipynb` (Jupyter Notebook): Parse cấu trúc JSON của Notebook để trích xuất toàn bộ các ô `code` và kết quả `outputs` có sẵn.
  * Với `PyQt6`: Đọc cấu trúc XML của file thiết kế giao diện `.ui`, file style `.qss` và logic kết nối tín hiệu (`signal/slot`) trong file `.py`.
* **Môn Web (`.html`, `.css`, `.js` hoặc `.zip`):**
  * Giải nén `.zip` trong môi trường kiểm soát (giới hạn dung lượng giải nén tối đa 50MB, giới hạn số file và độ sâu thư mục, loại bỏ `node_modules/`, `.git/`, `__pycache__/`).
  * Gom các file `.html`, `.css`, `.js` thành cây cấu trúc kèm nội dung code để kiểm tra các tiêu chí kỹ thuật.
* **Môn Scratch (`.sb3`) & GameMaker (`.yyz`, `.gml`, `.yy`):**
  * Giải nén ngầm file `.sb3` để trích xuất `project.json` (thống kê danh sách Nhân vật/Sprites, Biến số/Variables, Sự kiện/Events và các Khối lệnh/Blocks học sinh đã dùng).
  * Giải nén `.yyz` của GameMaker để trích xuất các file `.gml` (GameMaker Language) và cấu trúc Object/Event trong `.yy`.
* **Hình ảnh & Tài liệu (`.png`, `.jpg`, `.pdf`):**
  * Chuyển sang định dạng `inlineData` (Base64) gửi vào Multimodal input của `gemini-3.5-flash-lite`.
* **Nguyên tắc chấm an toàn:**
  * Nếu file hỏng hoặc không đọc được, đánh dấu `PARSE_ERROR` để giáo viên kiểm tra thủ công (không tự chấm 0 điểm, không tự tích yêu cầu làm lại).
  * AI chỉ chấm điểm từng tiêu chí trong barem kèm trích dẫn bằng chứng (`evidenceSnippet`) trong phạm vi kiến thức đã học; code TypeScript tự tính tổng điểm.

### 2. Cơ chế Quét Thư mục & Ghép nối `studentId` An toàn cho Bài Cuối Khóa (SPCK)

Giáo viên chuẩn bị thư mục gốc cho lớp trên ổ cứng:

```text
D:\SPCK_MindX\VT-C4K-PTA13\
├── Ngo Khoi Nguyen\
│   ├── thumb.png               (file có chữ thumb/bia hoặc ảnh đầu tiên -> Ảnh thumbnail *)
│   ├── screenshot1.png         (đưa vào mục Tải hình ảnh lên - tối đa 10 ảnh)
│   ├── screenshot2.jpg         (đưa vào mục Tải hình ảnh lên)
│   ├── project_source.zip      (đưa vào mục Tài liệu đính kèm - tối đa 10 files)
│   ├── thuyet_trinh.pptx       (đưa vào mục Tài liệu đính kèm)
│   └── links.txt               (dòng chứa youtube.com -> Youtube URL; link khác -> Đường dẫn liên quan)
├── Pham Thien Hoang Khang\
│   └── ...
```

* **Hybrid Folder-to-StudentID Mapping:**
  1. Hệ thống dùng `vietnamese-match.ts` để gợi ý ghép nối từng thư mục con với học viên tương ứng (`studentId` + `fullName`) trên LMS.
  2. Hiển thị **Bảng Ghép nối (Mapping Table)** trên المàn hình 3. Nếu lớp có học viên trùng tên hoặc độ khớp $< 100\%$, dòng đó sẽ được tô vàng cảnh báo và **bắt buộc giáo viên chọn xác nhận đúng `studentId` từ Dropdown** trước khi mở khóa nút Upload.

---

## PHẦN 4: CHECKLIST CÔNG VIỆC CHI TIẾT (ĐẦY ĐỦ 8 GIAI ĐOẠN: GIAI ĐOẠN 0 $\rightarrow$ 7)

> **Hướng dẫn sử dụng Checklist cho AI Agent:** Danh sách dưới đây bao gồm đầy đủ **8 giai đoạn (từ Giai đoạn 0 đến Giai đoạn 7)**, giữ nguyên 100% các tính năng của thiết kế ban đầu và tích hợp toàn bộ cơ chế an toàn dữ liệu. Khi thực hiện xong task nào, AI phải cập nhật trạng thái từ `[ ]` sang `[~]` (Đang làm) hoặc `[x]` (Đã hoàn thành) và kiểm tra đạt **Điều kiện nghiệm thu** trước khi qua giai đoạn mới.

---

### GIAI ĐOẠN 0: KHẢO SÁT THỰC TẾ (RECON) & KIỂM CHỨNG DOM / API / ID TRÊN LMS & TEACHING
> **Mục tiêu:** Chạy kịch bản khảo sát thực tế trên 1 lớp học thật để xác minh cơ chế đăng nhập, lấy chính xác cấu trúc ID (`classId`, `sessionId`, `studentId`, `submissionId`), kiểm tra màn hình lưu nhận xét sau buổi học và hành vi lưu dữ liệu.

* [x] **TASK-0.1:** Viết script khảo sát độc lập (`scripts/recon.ts`) mở trình duyệt Chromium với Persistent Context để đăng nhập thử vào `TEACHING_URL` và `LMS_URL`.
* [x] **TASK-0.2:** Lắng nghe Network API / GraphQL và kiểm tra DOM trên trang Teaching & LMS để ghi nhận cách lấy 4 mã định danh gốc: `classId`, `sessionId`, `studentId`, `submissionId`.
* [x] **TASK-0.3:** Khảo sát thực tế màn hình **Nhập nhận xét sau buổi học**:
  * [x] Xác định đường dẫn/tab chính xác nơi giáo viên nhập nhận xét từng buổi.
  * [x] Kiểm tra hành vi khi bấm Lưu nhận xét (Ghi đè vào ô nhận xét hiện tại hay Cộng dồn tạo bản ghi mới).
* [x] **TASK-0.4:** Kiểm tra thực tế cơ chế phân trang trên tab `Học viên` và tab `Chấm bài`, cách hoạt động của vùng Rich Text Editor `Nhận xét` và API trả về khi bấm `Lưu`.
* [x] **TASK-0.5:** Chạy thử 1 request mẫu gọi `gemini-3.5-flash-lite` với `GEMINI_API_KEY` trong `.env.local` để xác nhận kết nối và tốc độ phản hồi Structured Outputs.

> **✅ ĐIỀU KIỆN NGHIỆM THU GIAI ĐOẠN 0:** Đăng nhập tự động thành công; trích xuất được ID thật của 1 lớp học; xác định chính xác Selector và API của cả 3 màn hình (Nhận xét buổi học, Chấm bài tập, SPCK).

---

### GIAI ĐOẠN 1: KHỞI TẠO DỰ ÁN, CẤU HÌNH `.ENV`, SQLITE STATE DB & KHO GIÁO TRÌNH (SEED DATA)

* [x] **TASK-1.1:** Khởi tạo dự án Next.js 15+ (App Router, TypeScript, Tailwind CSS) và cấu hình chỉ lắng nghe trên `127.0.0.1:3000`.
* [x] **TASK-1.2:** Cài đặt các thư viện giao diện: `lucide-react`, `clsx`, `tailwind-merge`, và các component cơ bản (Button, Input, Select, Tabs, Table, Dialog, Badge, Progress, Drawer).
* [x] **TASK-1.3:** Cài đặt các thư viện Backend, Database & Automation: `playwright`, `better-sqlite3` (kèm `@types/better-sqlite3`), `@google/genai`, `adm-zip` (kèm `@types/adm-zip`), `xlsx` (xuất file Excel bảng điểm), `zod`.
* [x] **TASK-1.4:** Cấu hình `.gitignore` (loại trừ `.env.local`, `.playwright-profile/`, `temp_submissions/`, `data/mindx_bot.db`) và tạo `src/lib/config.ts` đọc biến môi trường:
  * [x] `TEACHING_URL` (Link hệ thống lịch dạy Teaching)
  * [x] `LMS_URL` (Link hệ thống MindX LMS)
  * [x] `MINDX_USERNAME` (Tài khoản giáo viên)
  * [x] `MINDX_PASSWORD` (Mật khẩu giáo viên)
  * [x] `GEMINI_API_KEY` (API Key của Google AI Studio)
  * [x] `GEMINI_MODEL` (Mặc định: `gemini-3.5-flash-lite`)
  * [x] `HEADLESS_MODE` (Mặc định: `false` để giáo viên nhìn thấy trình duyệt chạy)
  * [x] `ALLOWED_LOCAL_DIRS` (Danh sách thư mục trên máy tính được phép đọc khi quét SPCK)
* [x] **TASK-1.5:** Xây dựng cơ sở dữ liệu trạng thái bằng **SQLite** (`src/lib/db/sqlite.ts` $\rightarrow$ `data/mindx_bot.db`):
  * [x] Bảng `classes_sessions`: Lưu thông tin lớp, danh sách các buổi học thực tế (`classId`, `sessionId`, `sessionNumber`, `topic`).
  * [x] Bảng `students`: Lưu danh sách học viên theo `studentId`, `classId`, `fullName`, `isActive`.
  * [x] Bảng `session_feedbacks`: Lưu trạng thái điểm danh, `quickTagsJson`, `teacherNote`, nhận xét 3 phần của AI, `finalText`, `contentHash`, trạng thái (`DRAFT`, `APPROVED`, `SAVING`, `VERIFIED`, `FAILED`) và thời gian đối chiếu.
  * [x] Bảng `homework_submissions`: Lưu chuỗi liên kết `submissionId → studentId → localFilePath → fileHash`, trạng thái đọc file (`PARSED`, `PARSE_ERROR`), điểm từng tiêu chí, `calculatedScore`, `feedbackHtml`, `contentHash`, `status`.
  * [x] Bảng `spck_uploads`: Lưu ghép nối `studentId ↔ localFolderPath`, độ khớp tên, trạng thái xác nhận của giáo viên, gói file/link, nhận xét cuối khóa, `contentHash`, `status`.
  * [x] Bảng `job_logs`: Lưu nhật ký từng bước thực thi của Playwright Queue.
* [x] **TASK-1.6:** Xây dựng module đọc/ghi kho cấu hình JSON (`src/lib/db/json-config.ts`):
  * [x] Đọc/ghi `data/config/courses_syllabus.json` (Hỗ trợ số buổi học linh hoạt theo từng khóa, không khóa cứng 14 buổi).
  * [x] Đọc/ghi `data/config/grading_rubrics.json` (Lưu đề bài và barem chấm điểm chi tiết theo buổi).
  * [x] Đọc/ghi `data/config/quick_tags.json` (Lưu bộ thẻ đánh giá nhanh 1 chạm).
  * [x] Đọc/ghi `data/config/zalo_templates.json` (Lưu mẫu thông báo chung gửi nhóm Zalo).
* [x] **TASK-1.7:** Tạo dữ liệu mẫu ban đầu (Seed Data) đầy đủ cho các dòng khóa học phổ biến tại MindX (`PTA/PTB/PTI`, `JSB/JSA/JSI`, `SB/SA/SI`, `GB/GA/GI`, `ROB`, `CSI`).

> **✅ ĐIỀU KIỆN NGHIỆM THU GIAI ĐOẠN 1:** Khởi chạy `npm run dev` trên `127.0.0.1:3000` thành công; tự động khởi tạo file `mindx_bot.db` với đầy đủ các bảng và nạp sẵn dữ liệu mẫu các khóa học MindX.

---

### GIAI ĐOẠN 2: XÂY DỰNG LÕI PLAYWRIGHT ENGINE, HÀNG ĐỢI ĐƠN LUỒNG & TỰ ĐỘNG ĐĂNG NHẬP

* [x] **TASK-2.1:** Xây dựng `BrowserManager` Singleton (`src/lib/playwright/browser-manager.ts`):
  * [x] Khởi tạo `chromium.launchPersistentContext('./playwright-auth')` giữ nguyên phiên đăng nhập giữa các lần chạy.
  * [x] Cấu hình thư mục tải file mặc định về `./temp_submissions`.
  * [x] Cơ chế tự động khôi phục khi trình duyệt bị đóng thủ công.
* [x] **TASK-2.2:** Xây dựng Hàng đợi Tác vụ Đơn luồng `TaskQueue` (`src/lib/queue/task-queue.ts`):
  * [x] Đảm bảo tại mỗi thời điểm chỉ có 1 tác vụ điều khiển trang Playwright, tránh xung đột chuyển trang.
  * [x] Hỗ trợ phát sự kiện tiến trình thời gian thực (SSE) ra thanh Live Automation Log và hỗ trợ lệnh **Dừng khẩn cấp (`stopQueue()`)** để ngắt các tác vụ kế tiếp.
* [x] **TASK-2.3:** Tập trung toàn bộ Selectors vào `src/lib/playwright/selectors.ts` (đã kiểm chứng từ Giai đoạn 0):
  * [x] Selectors trang Đăng nhập Teaching & LMS.
  * [x] Selectors trang `Lớp học` (Ô tìm kiếm lớp, bảng danh sách lớp, Drawer chi tiết lớp).
  * [x] Selectors các Tab trong Drawer (`Lịch học`, `Bài tập về nhà`, `Chấm bài`, `Học viên`) và màn hình Nhận xét buổi học.
  * [x] Selectors Modal Chấm bài (Link file nộp, nút Download, Radio chấm điểm/làm lại, Input Điểm số, Rich Text Nhận xét, nút Lưu/Thoát).
  * [x] Selectors Form Sản phẩm cuối khóa (Nút Thêm SPCK, Tiêu đề, Youtube URL + nút Thêm, Thay ảnh Thumbnail, Dropzone Ảnh, Dropzone Tài liệu, Link liên quan + nút Thêm, Bình luận GV, nút Lưu).
* [x] **TASK-2.4:** Xây dựng hàm `ensureAuthenticated()` (`src/lib/playwright/auth.ts`):
  * [x] Kiểm tra trạng thái đăng nhập hiện tại trên LMS và Teaching.
  * [x] Nếu chưa đăng nhập hoặc hết hạn token, tự động lấy `TEACHING_USERNAME` / `TEACHING_PASSWORD` và `LMS_USERNAME` / `LMS_PASSWORD` để điền và submit form đăng nhập.
* [x] **TASK-2.5:** Xây dựng các hàm tiện ích xử lý UI & Network đặc thù của MindX LMS (`src/lib/playwright/lms-helpers.ts`):
  * [x] Hàm kiểm tra HTTP Status của đúng API nghiệp vụ đang gọi (bắt lỗi `401/403/500` chính xác) và chỉ đóng các Toast thông báo phụ ở góc dưới phải khi chúng che khuất vùng thao tác.
  * [x] Hàm duyệt qua toàn bộ các trang phân trang (`Số dòng mỗi trang: 100` + nút chuyển trang `>`) và đối chiếu tổng số bản ghi thực tế.
  * [x] Hàm mở Drawer của một lớp cụ thể theo `classId` / mã lớp (VD: `VT-C4K-PTA13`).

> **✅ ĐIỀU KIỆN NGHIỆM THU GIAI ĐOẠN 2:** Hàng đợi Playwright chạy tuần tự mượt mà; tự động đăng nhập và mở đúng Drawer của lớp học chỉ định mà không bị lỗi che khuất nút bấm.

---

### GIAI ĐOẠN 3: LUỒNG 1 (NHẬN XÉT BUỔI HỌC & ZALO) — ĐỒNG BỘ LỊCH, QUICK TAGS, AI 3 PHẦN & ĐỐI CHIẾU LMS
> **Mục tiêu:** Hoàn thiện khép kín luồng dọc đầu tiên: Đọc lớp/học viên/điểm danh theo ID $\rightarrow$ Chọn Quick Tags & Ghi chú $\rightarrow$ AI soạn nhận xét 3 phần (không bịa) $\rightarrow$ Lưu nháp SQLite $\rightarrow$ Duyệt $\rightarrow$ Ghi LMS $\rightarrow$ Đọc lại đối chiếu & Copy Zalo.

* [x] **TASK-3.1:** Viết kịch bản Playwright cào danh sách lớp, buổi học và điểm danh (`src/lib/playwright/sync-class.ts`):
  * [x] Lấy danh sách các lớp đang `Running` kèm `classId`.
  * [x] Lấy danh sách các buổi học thực tế của lớp kèm `sessionId` và trạng thái điểm danh.
  * [x] Quét Tab `Học viên` qua tất cả các trang để lấy danh sách học viên kèm `studentId`, trạng thái `Active` (Switch màu xanh) và kết hợp với điểm danh để xác định học viên đủ điều kiện nhận xét (`Active + Có mặt`).
* [x] **TASK-3.2:** Thiết lập Gemini Client (`src/lib/gemini/client.ts`) & Module sinh nhận xét 3 phần (`src/lib/gemini/comment-generator.ts`):
  * [x] Ẩn danh tên học viên thành mã `STUDENT_01`, `STUDENT_02` trước khi gửi lên Gemini API và ánh xạ lại tên thật theo `studentId` khi nhận kết quả.
  * [x] Đầu vào: Nội dung bài học hôm đó + Danh sách `Quick Tags` giáo viên đã tích + Ghi chú riêng của giáo viên.
  * [x] **Quy tắc chống bịa đặt:** Nếu học viên chưa được chọn Quick Tag nào và ô ghi chú trống, giữ trạng thái `Chưa đủ thông tin` (không gọi AI tự bịa).
  * [x] Đầu ra ép kiểu JSON chuẩn gồm 3 phần: `strengths` (Điểm mạnh), `improvements` (Điều cần cải thiện), `actionPlan` (Hướng rèn luyện) và `formattedFullComment`.
* [x] **TASK-3.3:** Xây dựng bộ tạo Thông báo chung cho cả lớp (Zalo Broadcast Generator):
  * [x] Tự động điền Tên lớp, Buổi học, Tóm tắt kiến thức đã học, Dặn dò bài tập về nhà vào mẫu Zalo chuẩn.
* [x] **TASK-3.4:** Viết kịch bản Playwright điền nhận xét lên LMS & Đối chiếu sau lưu (`src/lib/playwright/save-comments.ts`):
  * [x] Điền nhận xét đã duyệt (`APPROVED`) vào đúng học viên theo `studentId` và `sessionId` (hỗ trợ lưu thử 1 học viên trước hoặc lưu hàng loạt cả lớp).
  * [x] **Read-after-Write Verification:** Chờ API lưu trả về thành công, đọc ngược lại nội dung nhận xét trên LMS để so sánh với `finalText`. Nếu khớp 100% mới cập nhật trạng thái SQLite thành `VERIFIED`; nếu sửa nội dung sau khi duyệt thì tự động đưa về `WAITING_APPROVAL`.
* [x] **TASK-3.5:** Xây dựng Giao diện Màn hình 1 (`/session-comments`) — **Nhận xét Buổi học & Zalo**:
  * [x] Bộ chọn Lớp học & Buổi học + nút "Đồng bộ từ LMS".
  * [x] Dropdown chọn nhanh Nội dung bài học từ Syllabus (cho phép chỉnh sửa linh hoạt).
  * [x] Bảng danh sách học viên đi học: Cột bấm nhanh **Quick Tags** + Cột ghi chú nhanh (tự động lưu nháp tức thì vào SQLite) $\rightarrow$ Nút "AI Soạn Nhận Xét Hàng Loạt" $\rightarrow$ 3 cột kết quả (Điểm mạnh, Cần cải thiện, Hướng rèn luyện) cho phép sửa trực tiếp.
  * [x] Khung xem trước Thông báo Zalo + Nút "Copy Thông báo Zalo" & "Copy Nhận xét từng học viên".
  * [x] Nút "Duyệt & Lưu thử 1 học viên" và "Duyệt & Tự động Lưu cả lớp vào LMS" kèm trạng thái đối chiếu (`VERIFIED`).

> **✅ ĐIỀU KIỆN NGHIỆM THU GIAI ĐOẠN 3:**
> 1. AI không tự bịa thông tin nếu giáo viên chưa chọn Quick Tags/ghi chú.
> 2. Tải lại trang (F5) không mất bản nháp; sửa chữ sau khi duyệt bắt buộc phải duyệt lại.
> 3. Lưu nhận xét lên LMS, đọc lại đối chiếu khớp 100% và chạy lại không gây ghi trùng.

---

### GIAI ĐOẠN 4: LUỒNG 2 (BẢNG ĐIỂM BÁO CÁO) — CÀO BẢNG ĐIỂM ĐA TRANG & XUẤT EXCEL / GOOGLE SHEETS

* [x] **TASK-4.1:** Xây dựng kịch bản cào toàn bộ Bảng điểm lớp học (`src/lib/playwright/scrape-scores.ts`):
  * [x] Mở tab `Chấm bài` trong Drawer lớp học, duyệt qua toàn bộ các cột bài tập và các trang học viên.
  * [x] Quét ma trận `studentId` x `Homework/Thực hành`, phân biệt chính xác 4 trạng thái:
    1. `GRADED`: Đã chấm (lấy đúng điểm số, kể cả điểm `0/100`).
    2. `SUBMITTED_UNGRADED`: Đã nộp nhưng chưa chấm.
    3. `NOT_SUBMITTED`: Chưa nộp bài.
    4. `REDO_REQUESTED`: Yêu cầu học sinh làm lại.
* [x] **TASK-4.2:** Tích hợp chức năng Xuất báo cáo điểm:
  * [x] Xuất bảng điểm tổng hợp ra file Excel (`.xlsx`), `.csv` bằng thư viện `xlsx`.
  * [x] Nút "Copy Bảng điểm (Chuẩn Google Sheets)" để giáo viên dán thẳng vào file báo cáo.

> **✅ ĐIỀU KIỆN NGHIỆM THU GIAI ĐOẠN 4:** Dữ liệu bảng điểm khớp 100% với LMS trên mọi trang; phân biệt rõ học viên chưa nộp bài, chưa chấm và điểm 0.

---

### GIAI ĐOẠN 5: LUỒNG 3 (TỰ CHẤM BÀI TẬP TOP-DOWN: LMS $\rightarrow$ MÁY) — TẢI BÀI KÈM ID, PARSER ĐA MÔN, AI CHẤM THEO BAREM & ĐỐI CHIẾU
> **Mục tiêu:** Tự động tải bài nộp hợp lệ từ LMS về máy kèm khóa cứng định danh (`submissionId → studentId → path → hash`), đọc file đa môn, đề xuất điểm thành phần kèm bằng chứng code, tự cộng tổng điểm bằng code TypeScript, duyệt và lưu lên LMS.

* [ ] **TASK-5.1:** Xây dựng kịch bản tải file bài nộp tự động kèm khóa cứng ID (`src/lib/playwright/download-submissions.ts`):
  * [ ] Lọc mọi bài nộp hợp lệ trong buổi học được chọn (không phụ thuộc vào điểm danh buổi học).
  * [ ] Tự động mở Modal bài nộp, trích xuất `submissionId` và `studentId`.
  * [ ] Lắng nghe sự kiện download khi click vào icon tải xuống cạnh file đính kèm (VD: `1788605566199-baitapvenha.py`).
  * [ ] Lưu file về `./temp_submissions/{classId}/{lessonId}/{submissionId}_{fileName}`, tính `fileHash` (SHA-256) và ghi ngay chuỗi `submissionId → studentId → localFilePath → fileHash` vào SQLite.
* [ ] **TASK-5.2:** Xây dựng **Multi-Subject File Parser Engine** đầy đủ cho các môn học (`src/lib/file-parsers/index.ts`):
  * [ ] **Parser Python, Jupyter Notebook & PyQt6 (`.py`, `.ipynb`, `.ui`, `.qss`):** Đọc mã nguồn `.py`, trích xuất các cell `code`/`output` từ JSON của `.ipynb`, đọc cấu trúc XML giao diện `.ui` và style `.qss`.
  * [ ] **Parser Web & Code thuần (`.html`, `.css`, `.js`, `.txt`, `.sql`):** Đọc nội dung mã nguồn, kiểm tra cấu trúc thẻ/hàm.
  * [ ] **Parser File Nén An toàn (`.zip`):** Giải nén bằng `adm-zip` có kiểm soát chống Zip Bomb (giới hạn tổng dung lượng giải nén tối đa 50MB, giới hạn số lượng file và độ sâu thư mục, chặn `../`, bỏ qua `node_modules/`, `.git/`, `__pycache__/`).
  * [ ] **Parser Scratch (`.sb3`) & GameMaker (`.yyz`, `.gml`, `.yy`):** Giải nén `.sb3` lấy `project.json` (thống kê Sprites, Variables, Events, Blocks) và giải nén `.yyz` lấy code `.gml` / cấu trúc `.yy`.
  * [ ] **Parser Hình ảnh & Tài liệu (`.png`, `.jpg`, `.pdf`):** Chuyển đổi sang dạng `inlineData` (Base64) cho Multimodal input của Gemini.
  * [ ] **Xử lý lỗi đọc file (`PARSE_ERROR`):** Nếu file hỏng hoặc không đọc được, gắn cờ `PARSE_ERROR` để giáo viên kiểm tra thủ công, tuyệt đối không tự chấm 0 điểm hay tự chọn yêu cầu làm lại.
* [ ] **TASK-5.3:** Xây dựng AI Auto-Grader theo Barem & Bộ kiểm toán điểm (`src/lib/gemini/homework-grader.ts` & `score-auditor.ts`):
  * [ ] Ẩn danh tên học sinh và bọc nội dung bài nộp trong thẻ cách ly chống Prompt Injection (bỏ qua mọi chỉ dẫn giả mạo nằm trong comment code của học sinh).
  * [ ] Chỉ đánh giá trong phạm vi kiến thức đã học dựa trên Câu hỏi & Barem điểm (`grading_rubrics.json`).
  * [ ] Đầu ra JSON Schema trả về danh sách từng tiêu chí: `{ criterionId, criterionName, earnedPoints, maxPoints, evidenceSnippet, deductionReason }`, gợi ý quyết định (`"GRADE"` hoặc `"REDO"`) và `feedbackHtml`.
  * [ ] **Kiểm toán bằng code TypeScript (`score-auditor.ts`):** Kiểm tra `0 <= earnedPoints <= maxPoints` và **tự tính tổng điểm bằng code** (`calculatedScore = sum(earnedPoints)`), không tin trường tổng điểm do LLM tự cộng.
* [ ] **TASK-5.4:** Xây dựng kịch bản Playwright điền Điểm & Nhận xét vào Modal LMS + Đối chiếu (`src/lib/playwright/grade-worker.ts`):
  * [ ] Mở đúng Modal của `submissionId` đã được giáo viên duyệt (`APPROVED`).
  * [ ] Chọn đúng Radio button (`Chấm điểm` hoặc `Yêu cầu học sinh làm lại bài tập` theo quyết định của giáo viên).
  * [ ] Điền `Điểm số` (`calculatedScore`) và điền nội dung vào vùng Rich Text Editor `Nhận xét`.
  * [ ] Click nút `Lưu` màu xanh, chờ API hoàn tất, sau đó đọc lại dòng điểm trên bảng LMS để xác nhận trạng thái chuyển sang `Đã chấm` kèm đúng số điểm (`VERIFIED`).
* [ ] **TASK-5.5:** Xây dựng Giao diện Màn hình 2 (`/homework-grader`) — **Tự Chấm Bài Tập & Bảng Điểm Báo Cáo**:
  * [ ] Tab 1: **Bảng Điểm Tổng Hợp** (Hiển thị toàn bộ điểm các buổi của cả lớp, nút "Cào dữ liệu điểm mới nhất", nút "Xuất Excel / Copy Báo cáo").
  * [ ] Tab 2: **Chấm Bài Tự Động** (Chọn buổi học $\rightarrow$ Chọn Đề bài & Barem $\rightarrow$ Nút "Tải bài & AI Đề Xuất Điểm" $\rightarrow$ Bảng xem lại Code của HS, Điểm từng tiêu chí kèm bằng chứng, Tổng điểm, Nhận xét $\rightarrow$ Nút "Duyệt & Lưu điểm lên LMS").

> **✅ ĐIỀU KIỆN NGHIỆM THU GIAI ĐOẠN 5:**
> 1. Khóa cứng `submissionId → studentId`, không bao giờ chấm hoặc lưu nhầm người.
> 2. Tổng điểm tính chuẩn xác bằng code; mỗi tiêu chí trừ điểm đều có bằng chứng trích dẫn rõ ràng.
> 3. Lưu điểm lên LMS và đọc lại đối chiếu khớp 100%.

---

### GIAI ĐOẠN 6: LUỒNG 4 (AUTO UPLOAD SPCK BOTTOM-UP: MÁY $\rightarrow$ LMS) — QUÉT THƯ MỤC, GHÉP `studentId` & UPLOAD CHỐNG TRÙNG

* [ ] **TASK-6.1:** Xây dựng thuật toán gợi ý khớp tên & Bảng Ghép nối An toàn (`src/lib/utils/vietnamese-match.ts`):
  * [ ] Chuẩn hóa chuỗi tiếng Việt (bỏ dấu, viết thường, loại bỏ ký tự đặc biệt) để gợi ý ghép từng thư mục con trên máy tính (VD: `D:\SPCK\VT-C4K-PTA13\Ngo Khoi Nguyen`) với học viên có `studentId` tương ứng trên LMS (`Ngô Khôi Nguyên`).
  * [ ] Nếu lớp có học viên trùng tên hoặc độ khớp $< 100\%$, đánh dấu cảnh báo bắt buộc giáo viên chọn xác nhận `studentId` thủ công trên giao diện trước khi khóa cứng vào SQLite.
* [ ] **TASK-6.2:** Xây dựng bộ quét và kiểm tra gói tài nguyên SPCK (`src/lib/local-files/spck-scanner.ts`):
  * [ ] Kiểm tra đường dẫn thư mục nằm trong `ALLOWED_LOCAL_DIRS`.
  * [ ] Quét từng thư mục con của học viên và tự động phân loại + kiểm tra giới hạn LMS:
    * **Ảnh Thumbnail (`*`):** Tìm file có chữ `thumb` hoặc `bia`, nếu không có thì lấy ảnh đầu tiên (hoặc giữ nguyên ảnh mặc định của MindX nếu học viên không có ảnh riêng).
    * **Danh sách Hình ảnh (Tối đa 10 ảnh):** Các file `.png`, `.jpg`, `.jpeg`, `.webp`.
    * **Danh sách Tài liệu đính kèm (Tối đa 10 files):** Các file dự án `.py`, `.zip`, `.sb3`, `.yyz`, `.html`, `.pptx`, `.pdf`, `.docx`.
    * **Links (Youtube tối đa 5 videos & Link sản phẩm tối đa 5 links):** Tự động đọc từ file `links.txt` trong thư mục (dòng chứa `youtube.com`/`youtu.be` đưa vào Youtube URL, dòng khác đưa vào Đường dẫn liên quan) hoặc cho phép giáo viên dán trên Web App.
    * **Tiêu đề tự động (`*`):** Tạo mặc định `SPCK {Tên Học Viên}` hoặc `SPCK {Tên Dự Án}` (kiểm tra nghiêm ngặt độ dài $\le 100$ ký tự).
* [ ] **TASK-6.3:** Xây dựng AI Generator cho mục **`Bình luận của giáo viên*`** cuối khóa (`src/lib/gemini/spck-comment.ts`):
  * [ ] Đầu vào: Lịch sử nhận xét/điểm số của học viên trong SQLite, thông tin gói sản phẩm cuối khóa (kèm đọc sơ bộ cấu trúc code/slide đính kèm nếu có) và Quick Tags/ghi chú của giáo viên.
  * [ ] Đầu ra: Đoạn văn nhận xét cuối khóa hoàn chỉnh (đánh giá thái độ học tập, ý tưởng/đồ họa sản phẩm, kỹ thuật lập trình đã vận dụng và kỹ năng thuyết trình — không tự bịa kỹ năng thuyết trình nếu giáo viên không tích chọn).
* [ ] **TASK-6.4:** Xây dựng kịch bản Playwright Auto-Upload SPCK Chống Trùng & Đối chiếu (`src/lib/playwright/spck-uploader.ts`):
  * [ ] Mở trang SPCK của đúng `studentId` trên LMS.
  * [ ] **Kiểm tra chống trùng (Idempotency):** Kiểm tra khung `Sản Phẩm Học Viên 01` đã có sẵn chưa; nếu đã có thì cập nhật vào khung đó, chỉ click `+ Thêm sản phẩm học viên` khi chưa có khung nào.
  * [ ] Điền `Tiêu đề *` ($\le 100$ ký tự).
  * [ ] Với mỗi link Youtube chưa có trong danh sách: Điền vào ô `Nhập đường dẫn youtube tại đây` $\rightarrow$ **Bắt buộc click nút `+ Thêm`**.
  * [ ] Nếu có ảnh Thumbnail mới: Click `+ Thay ảnh` $\rightarrow$ dùng `fileChooser.setFiles()` nạp ảnh.
  * [ ] Nạp mảng ảnh vào vùng `Tải hình ảnh lên` (tối đa 10 ảnh).
  * [ ] Nạp mảng file dự án/slide vào vùng `Tài liệu đính kèm` (tối đa 10 files).
  * [ ] Với mỗi Đường dẫn liên quan chưa có trong danh sách: Điền `Đặt tên đường dẫn` + `Nhập đường dẫn` $\rightarrow$ **Bắt buộc click nút `+ Thêm`**.
  * [ ] Điền `Bình luận của giáo viên*`.
  * [ ] Chờ toàn bộ tiến trình upload file hoàn tất 100% ở tầng Network $\rightarrow$ Click nút `Lưu` màu xanh $\rightarrow$ Đọc lại khung SPCK trên LMS để đối chiếu đủ tiêu đề, file, link và nhận xét (`VERIFIED`).
* [ ] **TASK-6.5:** Xây dựng Giao diện Màn hình 3 (`/final-project`) — **Auto Upload Sản Phẩm Cuối Khóa (SPCK)**:
  * [ ] Ô chọn đường dẫn thư mục SPCK của lớp trên máy tính + Nút "Quét & Khớp Thư Mục Học Viên".
  * [ ] Bảng Ghép nối & Kiểm tra trực quan từng học viên: Cột xác nhận `studentId`, trạng thái khớp thư mục, số ảnh, số file đính kèm, ô nhập/sửa Link Youtube & Link dự án, ô sửa Tiêu đề và Bình luận cuối khóa.
  * [ ] Nút "AI Soạn Nhận Xét Cuối Khóa Cả Lớp".
  * [ ] Nút "Duyệt & Upload Thử 1 Học Viên" và "Duyệt & Tự Động Upload Cả Lớp Lên LMS".

> **✅ ĐIỀU KIỆN NGHIỆM THU GIAI ĐOẠN 6:**
> 1. Bảng Ghép nối khóa chặt `localFolderPath ↔ studentId`, không bao giờ upload nhầm bài giữa các học viên.
> 2. Mọi link Youtube và Đường dẫn liên quan đều được bấm `+ Thêm` đầy đủ.
> 3. Chạy lại tác vụ sau khi ngắt mạng không tạo thêm `Sản Phẩm Học Viên 02` trùng lặp và đối chiếu sau lưu khớp 100%.

---

### GIAI ĐOẠN 7: MÀN HÌNH QUẢN LÝ GIÁO TRÌNH (SYLLABUS), BAREM, LIVE LOG DRAWER & ĐÓNG GÓI SỬ DỤNG
> **Mục tiêu:** Cung cấp giao diện trực quan để giáo viên tự quản lý Nội dung bài học, Câu hỏi & Barem chấm điểm, Quick Tags, Mẫu Zalo ngay trên Web App; theo dõi tiến trình bot chạy thời gian thực và khởi động nhanh bằng 1 cú click đúp.

* [ ] **TASK-7.1:** Xây dựng Giao diện Màn hình 4 (`/syllabus-config`) — **Kho Nội Dung Bài Học, Barem Chấm Điểm & Mẫu Zalo**:
  * [ ] Giao diện thêm/sửa/xóa nhanh nội dung từng buổi học của từng khóa (`PTA/PTB/PTI`, `JSB/JSA/JSI`, `SB/SA/SI`, `GB/GA/GI`, `ROB`, `CSI`...) với số buổi linh hoạt để lưu cố định vào Web App.
  * [ ] Giao diện lưu sẵn Câu hỏi bài tập và Barem điểm chi tiết (từng tiêu chí + thang điểm) của từng buổi để tái sử dụng cho mọi lớp cùng khóa.
  * [ ] Giao diện tùy chỉnh bộ thẻ đánh giá nhanh (`Quick Tags`) và Mẫu thông báo Zalo (`Zalo Broadcast Template`).
* [ ] **TASK-7.2:** Xây dựng thanh **Live Automation Log / Status Drawer** (`src/components/live-log-drawer.tsx`):
  * [ ] Kết nối Server-Sent Events (SSE) với `TaskQueue` để hiển thị trạng thái thời gian thực khi Playwright đang chạy (VD: *"Đang tải bài của Phạm Thiện Hoàng Khang...", "Đã khóa submissionId #1289", "Đã bấm Lưu và đối chiếu VERIFIED trên LMS"*).
  * [ ] Nút **"Dừng khẩn cấp (Stop Bot)"** giúp giáo viên ngắt ngay các tác vụ tiếp theo trong hàng đợi bất cứ lúc nào (giữ nguyên trạng thái các bản ghi đã `VERIFIED` trước đó).
* [ ] **TASK-7.3:** Tạo bộ file khởi chạy nhanh 1 chạm cho giáo viên:
  * [ ] Tạo `start-bot.bat` (trên Windows) và `start-bot.command` (trên macOS) tự động kiểm tra môi trường, khởi chạy server local `http://127.0.0.1:3000` và mở trình duyệt để giáo viên chỉ cần click đúp chuột là dùng ngay.

> **✅ ĐIỀU KIỆN NGHIỆM THU GIAI ĐOẠN 7:** Giáo viên thêm/sửa được Giáo trình và Barem ngay trên giao diện Web; thanh Live Log hiển thị mượt mọi bước chạy của Playwright kèm nút Stop hoạt động tức thì; click đúp file chạy nhanh mở thẳng ứng dụng thành công.