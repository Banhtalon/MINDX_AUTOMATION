# KẾ HOẠCH TRIỂN KHAI & KIẾN TRÚC KỸ THUẬT: MINDX AUTOMATION BOT (v2.1 - FULL MASTER PLAN)

> **Kiểm định độc lập v3.1.1 — Vòng 3 (2026-10-28): GO trong phạm vi tái kiểm được yêu cầu.** Commit `3afb54c` đã đóng cả `R2-01` và `R2-02`: chuyển tiếp thao tác xóa hết thẻ khi ghi chú/điểm danh và bảo toàn thẻ đang chờ khi điểm danh cả lớp, kể cả bật thẻ mặc định. Chạy mới **7/7 cổng PASS**, probe gốc **18/18**, probe Vòng 2 **57/57**, Dashboard **8/8 tổ hợp đạt**; **48/48 assertion bổ sung PASS** (probe kết hợp 105/105, không cộng trùng). Đã xác nhận metadata xóa thẻ trong SQLite và giữ đúng ý định sau tải lại qua harness. Không sửa mã ứng dụng hoặc DB Owner; chưa nghiệm thu production/LMS thật. Báo cáo: `docs/audits/v311/CODEX_REVIEW_ROUND3.md`; bằng chứng mới: `docs/audits/v311/round3/`. Các kết luận NO-GO bên dưới là lịch sử vòng trước.

> **Phiên bản:** 3.2.0 (Bản đầy đủ 8 Giai đoạn + Trang riêng **Dự án Teaching `/teaching-projects` `v3.2.0`** + Tự động chuyển thẻ Robotics `ROB` & Tự nhớ Quick Tags từ buổi trước `v3.1.1` + Thiết kế lại toàn diện giao diện Chế độ Sáng / Tối Light Mode & Dark Mode 1 chạm `v3.1.0` + Quick Tags Lập trình/Robotics & Buổi Kiểm tra Checkpoint `v3.0.0` — Không lược bỏ tính năng)
>
> **Kiểm định độc lập v3.1.1 — Vòng 2 (2026-10-28): NO-GO.** Commit `2b70f95` chạy mới **6/6 cổng PASS**, probe vòng 1 **18/18 PASS**, Dashboard **8/8 tổ hợp vừa viewport**. Cả bốn biểu hiện vòng 1 đã hết; phạm vi lưu thẻ của R1-02 còn hai thiếu sót P2: `R2-01` không chuyển tiếp xóa trắng thẻ khi ghi chú/điểm danh lưu chồng nhau, `R2-02` điểm danh cả lớp bỏ qua thẻ đang chờ lưu. Probe mở rộng **47/57 PASS, 10 assertion FAIL thuộc hai lỗi**; so sánh component cũ xác nhận lỗi có sẵn, không quy là hồi quy mới của bản sửa. Không sửa mã ứng dụng hoặc DB Owner. Báo cáo và điều kiện GO: `docs/audits/v311/CODEX_REVIEW_ROUND2.md`; bằng chứng mới: `docs/audits/v311/round2/`.

> **Kiểm định v3.1.1 — Vòng 1 (2026-10-28): NO-GO.** Bốn cổng bắt buộc đều đạt trên DB cô lập; probe bổ sung đạt 12/18 kiểm tra. Cần đóng `R1-01` (test xóa toàn bộ nhận xét lớp thật), `R1-02` (mất trạng thái cần lưu thẻ kế thừa khi nhập chồng nhau/lỗi mạng), `R1-03` (chỉ kế thừa khi chứng minh được số buổi nhỏ hơn hiện tại). `R1-04` là khoảng thiếu nghiệm thu có sẵn: Dashboard 1366×768 cao 890px, cần điều chỉnh nếu yêu cầu vừa màn laptop. Chưa sửa mã ứng dụng; kiểm định lại theo tiêu chí tại `docs/audits/v311/CODEX_REVIEW_ROUND1.md`.
>
> **Kiểm định bản thiết kế lại v3.1.0 — Vòng 4 (2026-10-28): GO trong phạm vi xác minh giao diện được yêu cầu.** `R3-01` đã đóng: năm nhãn trạng thái và nhãn cổng SPCK dùng `.mindx-dark-keep`, chữ trắng và nền đậm mức 700, tương phản tối thiểu 5,36:1 qua bốn tổ hợp màu ứng dụng/hệ điều hành; giữ nguyên kết quả đạt của Vòng 1, `R2-01` và `R2-02`. Ba lệnh yêu cầu và probe mở rộng đều chạy mới đạt (exit 0). Không sửa mã ứng dụng; chưa chạy lại bản dựng đầy đủ, giới hạn lỗi export API có sẵn của Vòng 2 vẫn được ghi nhận. Reviewer Claude không có trong môi trường; Codex trực tiếp kiểm định. Hồ sơ: `docs/audits/v310/CODEX_REVIEW_ROUND4.md`.
>
> **Kiến trúc:** Local Web Application (Next.js App Router + TypeScript + Node.js, chạy trên `127.0.0.1:3000`)
>
> **Automation Engine:** Playwright (Persistent Context + Sequential Task Queue + Network Interception + Read-after-Write Verification + Self-Healing UI & Auto-Retry Pass 2 `v2.8.0` + Session 14 Course Final Evaluation Uploader `v2.9.0`)
>
> **Cập nhật v2.9.0 (2026-10-27 — Thiết kế lại toàn diện Buổi 14 Tổng kết cuối khóa):** Tách hoàn toàn **Buổi 14** khỏi màn hình Nhận xét buổi học (`/session-comments` chỉ áp dụng cho Buổi 1–13) và tích hợp trọn vẹn cả 2 Modal của Buổi 14 vào **Tab SPCK — Buổi 14 (`/final-project`)**:
> 1. **Modal Cột 3 (`"Sản phẩm của học sinh"`):** Nâng cấp AI viết `Bình luận của giáo viên*` Buổi 14 sang bố cục 2 mục (`1. Về phần thuyết trình` / `2. Về phần sản phẩm cuối khóa`) theo 5 mẫu thực tế của giáo viên, kèm quét sâu cấu trúc code Web (`.html/.css/.js`).
> 2. **Modal Cột 2 (`"Nhận xét học sinh"` — Đánh giá tổng kết cuối khóa & Thư từ MindX):** Tự động đọc 5 tiêu chí `Demo Score` (tối đa `5.0`) từ file `.xlsx` / Google Sheet **Bảng chấm điểm buổi Demo**, gợi ý/chọn 9 tiêu chí `Điểm Năng lực [ĐNL]` (`1..5`), dùng AI viết **Thư từ MindX 3 phần** (`Learned From Mindx`, `Suggestions From Mindx`, `Future Direction`) theo mẫu **Mccully Mac Dallas** (TypeScript tự ghép và đồng bộ chính xác `Điểm Demo` & `Điểm Năng lực`) và tự động điền 45 radio + 5 ô điểm + 3 ô `.ql-editor` lên LMS với **Read-after-Write Verification** toàn văn (`scripts/test-session14-v290.ts` PASS 7/7 `S14-01..S14-07`, Kiểm định độc lập Vòng 9 đạt **GO** — đóng toàn bộ 12/12 ranh giới `F01`–`F12`, 8/8 cổng kiểm thử PASS và 263/263 ca probe đạt 100%, chi tiết tại `docs/audits/v290/CODEX_REVIEW_ROUND9.md`).
>
> **Kiểm định v2.8.0 — Vòng 4 (2026-10-26 / 2026-10-27):** **GO** cho bản mã và đủ bảy cổng kiểm chứng; `F01`–`F04`, `R2-01`–`R2-02` và `R3-01` đều **CLOSED**. Fixture T11 đã đếm dialog theo `modalOpen`; giữ nguyên mã ứng dụng và toàn bộ điều kiện T01–T16 so với Vòng 3. Chạy mới **7/7 lệnh PASS**, v270 đạt đủ T01–T16; đồng thời đã sửa triệt để lỗi tự đăng nhập SSO (`base.mindx.edu.vn/login?callbackUrl=https://lms.mindx.edu.vn/admin/dashboard`), khử trùng lặp ảnh tự chụp `_spck_app_shots`, và **cho phép giữ lại các lớp vừa kết thúc (`Finished` trong vòng 15 ngày sau Buổi 14)** khi quét LMS (`sync-class.ts`, `api/spck/list/route.ts`) để giáo viên chỉnh sửa/upload bổ sung SPCK trong 1–2 tuần sau Buổi 14. Chi tiết: `docs/audits/v280/CODEX_REVIEW_ROUND4.md`.
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
   * Giáo viên chuẩn bị một thư mục cho cả lớp trên máy tính, bên trong có các **thư mục con đặt theo tên từng học viên** (chứa mã nguồn/giao diện ứng dụng, tài liệu đính kèm và file `links.txt` nếu có).
   * Ứng dụng quét thư mục lớp, gợi ý ghép nối tên thư mục với `studentId` trên LMS qua **Bảng Ghép nối (Mapping Table)** (cảnh báo nếu trùng tên hoặc khớp $< 100\%$ để giáo viên xác nhận), tự động mở ngầm giao diện ứng dụng (`.ui` PyQt6 hoặc Website `.html/.htm` qua máy chủ HTTP cục bộ `127.0.0.1` + Playwright khung `16:9 1440×810`) để chụp hình toàn bộ các màn hình giao diện (tự động khôi phục ảnh bị thiếu qua 4 tầng đối với `.ui` và tự động cuộn chụp đa phân đoạn đối với Website `.html`), dùng **Gemini Vision (`gemini-3.5-flash-lite`)** chọn 1 hình chụp giao diện đẹp nhất làm **Ảnh Thumbnail** (ô trên, hoặc ưu tiên ảnh do Owner tự tải lên) và đưa các hình chụp còn lại (kèm ảnh thuyết trình Demo tại lớp nếu có) vào **Hình ảnh sản phẩm** (ô dưới), đồng thời dùng AI soạn **Nhận xét tổng kết cuối khóa (`Bình luận của giáo viên *`)**.
   * Khi giáo viên duyệt, Bot kiểm tra chống trùng lặp trên LMS, mở form Sản Phẩm Học Viên của từng `studentId` (tự động vượt thanh cuộn ngang `.jss140` ở dòng cuối bảng), điền Tiêu đề ($\le 100$ ký tự, tuyệt đối không ghi `Giai đoạn 2` / `GĐ2`), thêm Youtube URL, thay ảnh Thumbnail, tải hình ảnh sản phẩm (xóa ảnh cũ/trùng lặp theo từng nhịp render React), tải tài liệu đính kèm (tự động đóng gói `.zip` cho mã nguồn `.html/.css/.js/.txt/.ui/.qss`), thêm đường dẫn liên quan (Link Google Drive SPCK / GitHub Pages), điền Bình luận của giáo viên (văn phong Học bạ sư phạm & trang trọng cho Phụ huynh xem, không chào hỏi, nêu rõ sản phẩm có gì và cần cải thiện gì, tuyệt đối không ghi `Giai đoạn 2` / `GĐ2` trong nhận xét AI), bấm **Lưu** và đối chiếu kết quả (`latestData.attachmentUrls` & `latestData.imageUrl`).

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
  * [x] **Read-after-Write Verification:** Chờ API lưu trả về thành công, đọc ngược lại nội dung nhận xét trên LMS để so sánh với `finalText` (hỗ trợ thử lại 3 lần khi mở lại modal `[role="dialog"]` sau khi bảng học viên cập nhật trạng thái `Auto Approved #1`, và đối chiếu trực tiếp ở chế độ xem khi chạy lại trên học viên đã lưu khớp 100%). Nếu khớp 100% mới cập nhật trạng thái SQLite thành `VERIFIED`; nếu sửa nội dung sau khi duyệt thì tự động đưa về `WAITING_APPROVAL`.
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

* [x] **AUDIT-R13:** Đã kiểm chứng độc lập Vòng 1–12 và lập `docs/audits/round-13/REPORT.vi.md`: R12-01 đạt; hồi quy và TypeScript đạt; hai bộ độc lập đạt 132/132 nhóm. Kết luận chuyển Giai đoạn 5: **NO-GO**, do `npm run build` bị môi trường chặn tạo tiến trình (`spawn EPERM`), chưa xác nhận bản dựng hoàn chỉnh; chưa nghiệm thu LMS thật trong vòng này.

* [x] **AUDIT-R14:** Đã đóng B13-BUILD và lập `docs/audits/round-14/REPORT.vi.md`: mã sản phẩm khớp dấu vân tay Vòng 13; đủ 5 lệnh kiểm tra thoát 0, bản dựng hoàn tất TypeScript và 18/18 trang; 132/132 nhóm độc lập và 49/49 mã lịch sử đạt. Kết luận hiện tại: **GO cấp mã nguồn để chuyển sang triển khai Giai đoạn 5**, thay thế NO-GO của AUDIT-R13; đã khôi phục `next-env.d.ts` đúng từng byte và giữ nguyên hồ sơ Vòng 12–13. Chưa nghiệm thu LMS thật hoặc hoàn thành tính năng Giai đoạn 5.

* [x] **AUDIT-R15:** Đã kiểm toán sâu độc lập Giai đoạn 1–4 và đối chiếu đủ 49 mã lịch sử; báo cáo tại `docs/audits/round-15/REPORT.vi.md`. Cả 5 lệnh bắt buộc thoát 0, 132/132 nhóm cũ đạt và build hoàn tất 18/18 trang; ca mới tái hiện 7 lỗi (4 P1, 3 P2), mở lại phạm vi R5-02 và R12-01. Kết luận hiện tại: **NO-GO cấp mã nguồn để chuyển sang Giai đoạn 5**, thay thế GO của AUDIT-R14; chưa sửa mã sản phẩm hoặc nghiệm thu LMS thật. Đã khôi phục `next-env.d.ts` đúng từng byte và bảo toàn hồ sơ Vòng 12–14.

* [x] **AUDIT-R16:** Đã kiểm toán độc lập Giai đoạn 1–4, đối chiếu đủ 56 mã tại `docs/audits/round-16/REPORT.vi.md`. Năm lệnh bắt buộc đạt ở lần chạy hợp lệ cuối; build hoàn tất 18/18 trang; 132/132 nhóm độc lập cũ và 7/7 kịch bản gốc Vòng 15 đạt. Ca mở rộng có 5 ca trượt thuộc 4 nhóm lỗi còn sót (nhánh AI thiếu dữ kiện cũ, thay điều kiện trước Save LMS, phân trang chậm/trống, xung đột lưu bị giấu trên UI); hai lỗi xác nhận thêm bằng ứng dụng thật với dữ liệu giả. Kết luận hiện tại: **NO-GO cấp mã nguồn để chuyển sang Giai đoạn 5**. Không sửa mã sản phẩm hoặc dùng LMS thật; giữ nguyên từng byte `next-env.d.ts` và hồ sơ Vòng 12–15.

* [x] **AUDIT-R17:** Đã kiểm toán độc lập và đối chiếu đủ 61 mã tại `docs/audits/round-17/REPORT.vi.md`. Sáu lệnh bắt buộc thoát 0, build đủ 18/18 trang; 148/148 nhóm độc lập cũ đạt, gồm 7 ca gốc Vòng 15 và 5 ca gốc Vòng 16. Bộ mở rộng cuối có 32/38 ca đạt, 6 ca trượt thuộc 4 nhóm lỗi (1 P1, 3 P2); hai lỗi UI xác nhận bằng Chromium/HTTP và dữ liệu giả. Kết luận hiện tại: **NO-GO cấp mã nguồn để chuyển sang Giai đoạn 5**. Không sửa sản phẩm hoặc dùng LMS/Gemini thật; 111 tệp bảo vệ gồm `next-env.d.ts` và hồ sơ Vòng 12–16 giữ nguyên từng byte.

* [x] **AUDIT-R18:** Đã kiểm chứng độc lập bốn bản sửa R17-01…04 và lập `docs/audits/round-18/REPORT.vi.md`. Bảy lệnh bắt buộc thoát 0; build hoàn tất 18/18 trang; các bộ độc lập Vòng 12/13/16/17 đạt 43/43 + 89/89 + 16/16 + 38/38 = 186/186 nhóm. Smoke Chromium/HTTP với dữ liệu giả xác nhận Copy đúng bản nháp khi thiếu thông tin, ba ô nhận xét vẫn hiện và xung đột Quick Tags hiển thị đúng thẻ đã lưu. Đối chiếu 65 mã, đóng bốn nhóm R17 trong phạm vi đã kiểm; kết luận hiện tại: **GO cấp mã nguồn để chuyển sang triển khai Giai đoạn 5**, thay thế NO-GO của AUDIT-R17. Không sửa mã sản phẩm; 149 tệp gồm `next-env.d.ts` và toàn bộ hồ sơ Vòng 12–17 giữ nguyên từng byte trong cây gốc. Chưa nghiệm thu tài khoản/dữ liệu/dịch vụ thật hoặc tính năng Giai đoạn 5.

> **✅ ĐIỀU KIỆN NGHIỆM THU GIAI ĐOẠN 4:** Dữ liệu bảng điểm khớp 100% với LMS trên mọi trang; phân biệt rõ học viên chưa nộp bài, chưa chấm và điểm 0.

---

### GIAI ĐOẠN 5: LUỒNG 3 (TỰ CHẤM BÀI TẬP TOP-DOWN: LMS $\rightarrow$ MÁY) — TẢI BÀI KÈM ID, PARSER ĐA MÔN, AI CHẤM THEO BAREM & ĐỐI CHIẾU
> **Mục tiêu:** Tự động tải bài nộp hợp lệ từ LMS về máy kèm khóa cứng định danh (`submissionId → studentId → path → hash`), đọc file đa môn, đề xuất điểm thành phần kèm bằng chứng code, tự cộng tổng điểm bằng code TypeScript, duyệt và lưu lên LMS.

* [x] **TASK-5.1:** Xây dựng kịch bản tải file bài nộp tự động kèm khóa cứng ID (`src/lib/playwright/download-submissions.ts`):
  * [x] Lọc mọi bài nộp hợp lệ trong buổi học được chọn (không phụ thuộc vào điểm danh buổi học).
  * [x] Tự động mở Modal bài nộp, trích xuất `submissionId` và `studentId`.
  * [x] Lắng nghe sự kiện download khi click vào icon tải xuống cạnh file đính kèm (VD: `1788605566199-baitapvenha.py`).
  * [x] Lưu file về `./temp_submissions/{classId}/{lessonId}/{submissionId}_{fileName}`, tính `fileHash` (SHA-256) và ghi ngay chuỗi `submissionId → studentId → localFilePath → fileHash` vào SQLite.
* [x] **TASK-5.2:** Xây dựng **Multi-Subject File Parser Engine** đầy đủ cho các môn học (`src/lib/file-parsers/index.ts`):
  * [x] **Parser Python, Jupyter Notebook & PyQt6 (`.py`, `.ipynb`, `.ui`, `.qss`):** Đọc mã nguồn `.py`, trích xuất các cell `code`/`output` từ JSON của `.ipynb`, đọc cấu trúc XML giao diện `.ui` và style `.qss`.
  * [x] **Parser Web & Code thuần (`.html`, `.css`, `.js`, `.txt`, `.sql`):** Đọc nội dung mã nguồn, kiểm tra cấu trúc thẻ/hàm.
  * [x] **Parser File Nén An toàn (`.zip`):** Giải nén bằng `adm-zip` có kiểm soát chống Zip Bomb (giới hạn tổng dung lượng giải nén tối đa 50MB, giới hạn số lượng file và độ sâu thư mục, chặn `../`, bỏ qua `node_modules/`, `.git/`, `__pycache__/`).
  * [x] **Parser Scratch (`.sb3`) & GameMaker (`.yyz`, `.gml`, `.yy`):** Giải nén `.sb3` lấy `project.json` (thống kê Sprites, Variables, Events, Blocks) và giải nén `.yyz` lấy code `.gml` / cấu trúc `.yy`.
  * [x] **Parser Hình ảnh & Tài liệu (`.png`, `.jpg`, `.pdf`):** Chuyển đổi sang dạng `inlineData` (Base64) cho Multimodal input của Gemini.
  * [x] **Xử lý lỗi đọc file (`PARSE_ERROR`):** Nếu file hỏng hoặc không đọc được, gắn cờ `PARSE_ERROR` để giáo viên kiểm tra thủ công, tuyệt đối không tự chấm 0 điểm hay tự chọn yêu cầu làm lại.
* [x] **TASK-5.3:** Xây dựng AI Auto-Grader theo Barem & Bộ kiểm toán điểm (`src/lib/gemini/homework-grader.ts` & `score-auditor.ts`):
  * [x] Ẩn danh tên học sinh và bọc nội dung bài nộp trong thẻ cách ly chống Prompt Injection (bỏ qua mọi chỉ dẫn giả mạo nằm trong comment code của học sinh).
  * [x] Chỉ đánh giá trong phạm vi kiến thức đã học dựa trên Câu hỏi & Barem điểm (`grading_rubrics.json`).
  * [x] Đầu ra JSON Schema trả về danh sách từng tiêu chí: `{ criterionId, criterionName, earnedPoints, maxPoints, evidenceSnippet, deductionReason }`, gợi ý quyết định (`"GRADE"` hoặc `"REDO"`) và `feedbackHtml`.
  * [x] **Kiểm toán bằng code TypeScript (`score-auditor.ts`):** Kiểm tra `0 <= earnedPoints <= maxPoints` và **tự tính tổng điểm bằng code** (`calculatedScore = sum(earnedPoints)`), không tin trường tổng điểm do LLM tự cộng.
* [x] **TASK-5.4:** Xây dựng kịch bản Playwright điền Điểm & Nhận xét vào Modal LMS + Đối chiếu (`src/lib/playwright/grade-worker.ts`):
  * [x] Mở đúng Modal của `submissionId` đã được giáo viên duyệt (`APPROVED`).
  * [x] Chọn đúng Radio button (`Chấm điểm` hoặc `Yêu cầu học sinh làm lại bài tập` theo quyết định của giáo viên).
  * [x] Điền `Điểm số` (`calculatedScore`) và điền nội dung vào vùng Rich Text Editor `Nhận xét`.
  * [x] Click nút `Lưu` màu xanh, chờ API hoàn tất, sau đó đọc lại dòng điểm trên bảng LMS để xác nhận trạng thái chuyển sang `Đã chấm` kèm đúng số điểm (`VERIFIED`).
* [x] **TASK-5.5:** Xây dựng Giao diện Màn hình 2 (`/homework-grader`) — **Tự Chấm Bài Tập & Bảng Điểm Báo Cáo**:
  * [x] Tab 1: **Bảng Điểm Tổng Hợp** (Hiển thị toàn bộ điểm các buổi của cả lớp, nút "Cào dữ liệu điểm mới nhất", nút "Xuất Excel / Copy Báo cáo").
  * [x] Tab 2: **Chấm Bài Tự Động** (Chọn buổi học $\rightarrow$ Chọn Đề bài & Barem $\rightarrow$ Nút "Tải bài & AI Đề Xuất Điểm" $\rightarrow$ Bảng xem lại Code của HS, Điểm từng tiêu chí kèm bằng chứng, Tổng điểm, Nhận xét $\rightarrow$ Nút "Duyệt & Lưu điểm lên LMS").

> **✅ ĐIỀU KIỆN NGHIỆM THU GIAI ĐOẠN 5:**
> 1. Khóa cứng `submissionId → studentId`, không bao giờ chấm hoặc lưu nhầm người.
> 2. Tổng điểm tính chuẩn xác bằng code; mỗi tiêu chí trừ điểm đều có bằng chứng trích dẫn rõ ràng.
> 3. Lưu điểm lên LMS và đọc lại đối chiếu khớp 100%.

* [x] **AUDIT-R19:** Đã kiểm toán độc lập TASK-5.1–TASK-5.5 và hồi quy Giai đoạn 1–4 tại `docs/audits/round-19/REPORT.vi.md`. Chạy đủ 9 lệnh bắt buộc trong bản sao cô lập: 8 lệnh thoát 0; bộ độc lập R19 thoát 1 với 74/94 ca đạt, 20 ca trượt thuộc 14 nhóm lỗi mở (10 P1, 4 P2). Các bộ Vòng 12/13/16/17 đạt 43/43 + 89/89 + 16/16 + 38/38 = 186/186 nhóm; TypeScript và build 22/22 trang đạt. Kết luận: **NO-GO Giai đoạn 5** do còn lỗi định danh bài/học viên/buổi, kiểm toán/duyệt điểm, bảo vệ file và xác nhận lưu LMS. Không sửa mã sản phẩm, không dùng LMS/Gemini/DB thật; 194 tệp gồm `next-env.d.ts` và toàn bộ hồ sơ Vòng 12–18 giữ nguyên từng byte trong cây gốc. Dấu hoàn thành này xác nhận đã làm kiểm toán, không xác nhận nghiệm thu TASK-5.x; cần sửa và kiểm chứng lại trước khi dùng dữ liệu thật.

* [x] **AUDIT-R20:** Đã kiểm chứng độc lập 14 nhóm R19-01–R19-14 tại `docs/audits/round-20/REPORT.vi.md`: 6 nhóm đóng trong phạm vi mã nguồn, 8 nhóm mới sửa một phần còn mở (7 P1, 1 P2). Chạy đủ 10 lệnh bắt buộc trong bản sao TEMP cô lập: 9 lệnh thoát 0; bộ R20 thoát 1 với 129/145 ca đạt (đủ 94 ca R19 và 51 ca bổ sung), 16 ca trượt có bằng chứng. R19 chạy nguyên bản đạt 94/94; hồi quy R12/13/16/17 đạt 186/186; TypeScript và build 22/22 trang đạt. Kết luận: **NO-GO cấp mã nguồn Giai đoạn 5**, chưa ký nghiệm thu. Không sửa mã sản phẩm; bảo toàn SHA-256 233/233 tệp gồm `next-env.d.ts` và toàn bộ hồ sơ Vòng 12–19. Chưa dùng LMS/Gemini/DB thật; dấu hoàn thành chỉ xác nhận hoàn tất kiểm toán.

* [x] **AUDIT-R23:** Đã hoàn tất kiểm toán độc lập Giai đoạn 5 tại `docs/audits/round-23/REPORT.vi.md`; phán quyết **NO-GO cấp mã nguồn**, chưa nghiệm thu. Có 10/14 nhóm CLOSED_SOURCE, còn R19-01/R19-06/R19-09/R19-13; R23 đạt 92/116, còn 24 ca trượt. R22/R21/R20 nguyên bản đạt 53/53, 49/49, 145/145; hồi quy R12/13/16/17 đạt 185/186 (R16 lệch kỳ vọng 7 bảng so với 8 bảng hiện tại). Đã chạy đủ 12 lệnh trong snapshot TEMP: 10 PASS, 2 FAIL; Phase 4/5, TypeScript và build đạt. Giữ nguyên 364/364 tệp bảo vệ, không sửa src/scripts và không dùng dịch vụ hoặc dữ liệu thật. Dấu hoàn tất chỉ xác nhận đã làm kiểm toán, không ký nghiệm thu TASK-5.x.

* [x] **AUDIT-R24:** Đã hoàn tất kiểm toán độc lập Giai đoạn 5 tại `docs/audits/round-24/REPORT.vi.md`; phán quyết **NO-GO cấp mã nguồn**, chưa nghiệm thu. Có **12/14 nhóm CLOSED_SOURCE**, mới đóng R19-06/R19-13, còn R19-01 (P2)/R19-09 (P1). R24 đạt **203/230**, còn 27 ca trượt; R23/R22/R21 nguyên bản chạy mới đạt **116/116, 53/53, 49/49**. R20 nguyên bản **141/145** do bốn ca cũ thiếu snapshot duyệt bắt buộc; bốn đối chứng tương thích R24 đủ snapshot đạt, không sửa lịch sử. Hồi quy R12/13/16/17 đạt **185/186**, R16 vẫn lệch kỳ vọng 7 bảng so với 8; đối chứng schema tương thích đạt. Đủ **13 lệnh bắt buộc** trong snapshot TEMP: 10 PASS, 3 FAIL; Phase 4/5, TypeScript và build **22/22 trang** đạt. Nạp trực tiếp mô-đun sản phẩm xác nhận lại sáu ca WebP/PDF hỏng bị nhận. Giữ nguyên **417/417 tệp bảo vệ** và **57/57 tệp src/scripts**; không dùng dịch vụ hoặc dữ liệu thật. Dấu hoàn tất chỉ xác nhận đã làm kiểm toán, không ký nghiệm thu TASK-5.x.

* [x] **AUDIT-R27:** Đã hoàn tất kiểm toán độc lập Giai đoạn 5 tại `docs/audits/round-27/REPORT.vi.md`; phán quyết **NO-GO cấp mã nguồn**, chưa nghiệm thu TASK-5.x. Có **12/14 nhóm CLOSED_SOURCE**, còn R19-01 (P2) và R19-09 (P1). R26 chạy mới đạt **510/510**, native media **94/94**, native worker **54/54**; R27 đạt **650/662**, native xác nhận đúng **12 ca trượt mới** (4 PDF và 8 request/response). TypeScript trước/sau build, build **22/22 trang**, Phase 4/5 đạt. Các kết quả lịch sử lệch hợp đồng được giữ nguyên và giải thích riêng, không đổi thành PASS. Giữ nguyên **652/652 tệp bảo vệ** gồm next-env.d.ts và hồ sơ Vòng 12–26, **57/57 tệp src/scripts**; chỉ thêm hồ sơ R27 và mục tài liệu này, không sửa sản phẩm, không dùng tài khoản/dịch vụ/DB/bài nộp thật. Dấu hoàn tất chỉ xác nhận đã làm kiểm toán, không ký nghiệm thu.

* [x] **AUDIT-R28:** Đã hoàn tất kiểm toán độc lập Giai đoạn 5 tại `docs/audits/round-28/REPORT.vi.md`; **NO-GO cấp mã nguồn, 12/14 CLOSED_SOURCE**, chưa nghiệm thu. Đã đóng đủ 12 lỗi R27: R27 662/662, native media 120/120, native worker 32/32. R28 giữ nguyên 662 ca và thêm 75 ca, đạt **728/737**; native xác nhận 6 PDF sai cấu trúc được nhận và 3 block string GraphQL hợp lệ bị từ chối. Hai nhóm R19-01/R19-09 còn P2; không tái hiện VERIFIED sai P1 của R27 trong phạm vi đã kiểm. R22–R26, Phase 4/5, TypeScript trước/sau build và build 22/22 trang đạt; kết quả lịch sử nguyên bản được giữ và giải thích riêng. Bảo toàn 772/772 tệp bảo vệ gồm next-env.d.ts và R12–R27, 57/57 src/scripts; không sửa sản phẩm, không dùng dữ liệu/dịch vụ thật. Dấu [x] chỉ xác nhận đã làm kiểm toán.

* [ ] **NGHIỆM THU SAU AUDIT-R28:** Chưa đạt 14/14 CLOSED_SOURCE / GO; sửa theo `docs/audits/round-28/FIX_PROMPT.vi.md` và kiểm toán lại đúng nguồn cuối trước khi ký nghiệm thu Giai đoạn 5.

* [x] **AUDIT-R29:** Đã hoàn tất kiểm toán độc lập Giai đoạn 5 tại `docs/audits/round-29/REPORT.vi.md`; **NO-GO cấp mã nguồn, 13/14 CLOSED_SOURCE**, chưa nghiệm thu. Đã đóng đủ 9 lỗi R28: R28 **737/737**, native media **163/163**, native worker **64/64**. R29 giữ nguyên 737 ca và thêm 78 ca, đạt **807/815**; native xác nhận 8 PDF trượt mới (6 sai cú pháp vẫn được nhận, 2 dùng NUL hợp lệ bị từ chối). R19-09 đã CLOSED_SOURCE; còn R19-01 P2, không tái hiện VERIFIED sai trong phạm vi kiểm. R22–R27 cùng các bộ native yêu cầu, Phase 4/5, TypeScript trước/sau build và build **22/22 trang** đạt; giữ nguyên kết quả lịch sử lệch hợp đồng và các bộ tự chặn chạy lại. Bảo toàn **905/905 tệp bảo vệ** gồm next-env.d.ts và R12–R28, **57/57 src/scripts**; không sửa sản phẩm, không dùng tài khoản/dịch vụ/DB/bài nộp thật. Dấu [x] chỉ xác nhận đã làm kiểm toán.

* [ ] **NGHIỆM THU SAU AUDIT-R29:** Chưa đạt 14/14 CLOSED_SOURCE / GO; sửa bộ đọc PDF theo `docs/audits/round-29/FIX_PROMPT.vi.md` và kiểm toán lại đúng nguồn cuối trước khi ký nghiệm thu Giai đoạn 5.

* [x] **AUDIT-R30:** Đã hoàn tất kiểm toán độc lập Giai đoạn 5 tại `docs/audits/round-30/REPORT.vi.md`; **NO-GO cấp mã nguồn, 13/14 CLOSED_SOURCE**, còn R19-01 P2. Đóng đủ **8/8 ca PDF R29**; R29 nguyên bản đạt **815/815, 217/217, 88/88**. R30 giữ nguyên 815 ca và thêm bốn ca, đạt **817/819**, native media **219/221**, native worker **88/88**; hai PDF hợp lệ chứa Name rỗng trong mảng/từ điển con bị từ chối. Nguồn R29 đúng hash nhận chúng; pypdf strict và oracle byte độc lập xác nhận **4/4** mẫu/đối chứng hợp lệ. R28 **737/737, 163/163, 64/64**; R27 **662/662, 120/120, 32/32**; R26 **510/510, 94/94, 54/54**; R22–R25 cùng native yêu cầu, Phase 4/5, TypeScript trước/sau build và build **22/22 trang** đạt. Oracle PDF đủ **54/54** kỳ vọng R29, GraphQL **88/88**; nguồn TEMP R28/R29 khớp hash 57/57 src/scripts. Giữ nguyên lịch sử FAIL/BLOCKED và 10 đối chứng tương thích đạt. Có 42 lệnh/48 lượt chạy trong TEMP; bảo toàn **1051/1051** tệp bảo vệ gồm next-env.d.ts và R12–R29, **57/57 src/scripts**; không sửa sản phẩm hoặc dùng tài khoản/dịch vụ/DB/bài nộp thật. Dấu [x] chỉ xác nhận hoàn tất kiểm toán.

* [ ] **NGHIỆM THU SAU AUDIT-R30 — CẤP MÃ NGUỒN:** Chưa đạt 14/14 CLOSED_SOURCE / GO; sửa hẹp giá trị Name rỗng hợp lệ trong bộ đọc PDF theo `docs/audits/round-30/FIX_PROMPT.vi.md` rồi kiểm toán lại đúng nguồn cuối. Chưa nghiệm thu vận hành LMS/Gemini thật; không đổi checkbox TASK-5.x hoặc các mục nghiệm thu cũ.

* [x] **AUDIT-R31:** Đã hoàn tất kiểm toán độc lập Giai đoạn 5 tại `docs/audits/round-31/REPORT.vi.md`; **GO cấp mã nguồn, 14/14 nhóm R19-01..R19-14 đạt CLOSED_SOURCE**. Đóng hoàn toàn 2 ca PDF Name rỗng của R30; đạt 819/819 ca chính, 221/221 native media, 88/88 native worker, 4/4 pdf-name-repro, 28/28 pdf-boundary-repro, 54/54 pdf_dict_oracle, 88/88 graphql_worker_oracle, cùng toàn bộ chuỗi hồi quy R29..R22 và TypeScript trước/sau `next build --webpack` 22/22 trang. Đã chạy thêm Live Flight Test thực tế (`TASK-5.1`..`TASK-5.5`) đạt 100%.

* [x] **AUDIT-R35:** Đã hoàn tất kiểm toán độc lập TASK-5.1..TASK-5.5 trên nguồn hiện tại tại `docs/audits/round-35/REPORT.vi.md`, cấu hình reviewer `gpt-6.1-sol` (high). Đủ 7 lệnh bắt buộc chạy trong TEMP đều đạt (819/819, 221/221, 88/88, 4/4, 28/28, Phase 5 đủ 7 nhóm, TypeScript không lỗi). Tuy nhiên 7 tình huống mới tái hiện 1 lỗi P1 và 6 lỗi P2: sai thang điểm barem GĐ7, mất nháp, đổi buổi kẹt tải, Stop không dừng lượt AI, bỏ sót bài mới do cache, Scratch thiếu biểu thức và YYZ bỏ qua mã hỏng. Kết luận **NO-GO**; giữ nguyên 1.653/1.653 tệp bảo vệ gồm next-env.d.ts và R12–R34, không sửa sản phẩm/không dùng dữ liệu thật. Dấu [x] chỉ xác nhận hoàn tất kiểm toán, không xác nhận nghiệm thu TASK-5.x.

---

### GIAI ĐOẠN 6: LUỒNG 4 (AUTO UPLOAD SPCK BOTTOM-UP: MÁY $\rightarrow$ LMS) — QUÉT THƯ MỤC, GHÉP `studentId` & UPLOAD CHỐNG TRÙNG

* [x] **TASK-6.1:** Xây dựng thuật toán gợi ý khớp tên & Bảng Ghép nối An toàn (`src/lib/utils/vietnamese-match.ts`):
  * [x] Chuẩn hóa chuỗi tiếng Việt (bỏ dấu, viết thường, loại bỏ ký tự đặc biệt) để gợi ý ghép từng thư mục con trên máy tính (VD: `D:\SPCK\VT-C4K-PTA13\Ngo Khoi Nguyen`) với học viên có `studentId` tương ứng trên LMS (`Ngô Khôi Nguyên`).
  * [x] Nếu lớp có học viên trùng tên hoặc độ khớp $< 100\%$, đánh dấu cảnh báo bắt buộc giáo viên chọn xác nhận `studentId` thủ công trên giao diện trước khi khóa cứng vào SQLite.
* [x] **TASK-6.2:** Xây dựng bộ quét và kiểm tra gói tài nguyên SPCK (`src/lib/local-files/spck-scanner.ts`):
  * [x] Kiểm tra đường dẫn thư mục nằm trong `ALLOWED_LOCAL_DIRS`.
  * [x] Quét từng thư mục con của học viên và tự động phân loại + kiểm tra giới hạn LMS:
    * **Ảnh Thumbnail (`*`):** Tìm file có chữ `thumb` hoặc `bia`, nếu không có thì lấy ảnh đầu tiên (hoặc giữ nguyên ảnh mặc định của MindX nếu học viên không có ảnh riêng).
    * **Danh sách Hình ảnh (Tối đa 10 ảnh):** Các file `.png`, `.jpg`, `.jpeg`, `.webp`.
    * **Danh sách Tài liệu đính kèm (Tối đa 10 files):** Các file dự án `.py`, `.zip`, `.sb3`, `.yyz`, `.html`, `.pptx`, `.pdf`, `.docx`.
    * **Links (Youtube tối đa 5 videos & Link sản phẩm tối đa 5 links):** Tự động đọc từ file `links.txt` trong thư mục (dòng chứa `youtube.com`/`youtu.be` đưa vào Youtube URL, dòng khác đưa vào Đường dẫn liên quan) hoặc cho phép giáo viên dán trên Web App.
    * **Tiêu đề tự động (`*`):** Tạo mặc định `SPCK {Tên Học Viên}` hoặc `SPCK {Tên Dự Án}` (kiểm tra nghiêm ngặt độ dài $\le 100$ ký tự).
* [x] **TASK-6.3:** Xây dựng AI Generator cho mục **`Bình luận của giáo viên*`** cuối khóa (`src/lib/gemini/spck-comment.ts`):
  * [x] Đầu vào: Lịch sử nhận xét/điểm số của học viên trong SQLite, thông tin gói sản phẩm cuối khóa (kèm đọc sơ bộ cấu trúc code/slide đính kèm nếu có) và Quick Tags/ghi chú của giáo viên.
  * [x] Đầu ra: Đoạn văn nhận xét cuối khóa hoàn chỉnh (đánh giá thái độ học tập, ý tưởng/đồ họa sản phẩm, kỹ thuật lập trình đã vận dụng và kỹ năng thuyết trình — không tự bịa kỹ năng thuyết trình nếu giáo viên không tích chọn).
* [x] **TASK-6.4:** Xây dựng kịch bản Playwright Auto-Upload SPCK Chống Trùng & Đối chiếu (`src/lib/playwright/spck-uploader.ts`):
  * [x] Mở trang SPCK / Modal `Sản phẩm của học sinh` tại đúng **Buổi 12, Buổi 13 hoặc Buổi 14** trên tab `Comments` (`#tab-10`) của đúng học viên trên LMS.
  * [x] **Kiểm tra chống trùng (Idempotency):** Kiểm tra khung `Sản Phẩm Học Viên 01` đã có sẵn chưa; nếu đã có thì cập nhật vào khung đó, chỉ click `+ Thêm sản phẩm học viên` khi chưa có khung nào.
  * [x] Điền `Tiêu đề *` ($\le 100$ ký tự).
  * [x] Với mỗi link Youtube chưa có trong danh sách: Điền vào ô `Nhập đường dẫn youtube tại đây` $\rightarrow$ **Bắt buộc click nút `+ Thêm`**.
  * [x] Nếu có ảnh Thumbnail mới: Click `+ Thay ảnh` $\rightarrow$ dùng `fileChooser.setFiles()` nạp ảnh.
  * [x] Nạp mảng ảnh vào vùng `Tải hình ảnh lên` (tối đa 10 ảnh).
  * [x] Nạp mảng file dự án/slide vào vùng `Tài liệu đính kèm` (tối đa 10 files).
  * [x] Với mỗi Đường dẫn liên quan chưa có trong danh sách: Điền `Đặt tên đường dẫn` + `Nhập đường dẫn` $\rightarrow$ **Bắt buộc click nút `+ Thêm`**.
  * [x] Điền `Bình luận của giáo viên*`.
  * [x] Chờ toàn bộ tiến trình upload file hoàn tất 100% ở tầng Network $\rightarrow$ Click nút `Lưu` màu xanh $\rightarrow$ Đọc lại khung SPCK trên LMS để đối chiếu đủ tiêu đề, file, link và nhận xét (`VERIFIED`).
* [x] **TASK-6.5:** Xây dựng Giao diện Màn hình 3 (`/final-project`) — **Auto Upload Sản Phẩm Cuối Khóa (SPCK)**:
  * [x] Tự động quét theo tài khoản giáo viên trên LMS và **chỉ hiển thị các lớp đang có buổi học $\ge 12$** để nộp SPCK (kèm nút "Quét lớp TK GV (≥ 12)").
  * [x] Ô chọn đường dẫn thư mục SPCK của lớp trên máy tính (tích hợp nút "Chọn thư mục..." ngay trên trang web) + Nút "Quét & Khớp Thư Mục Học Viên".
  * [x] Tự động tải sản phẩm trong thư mục trên máy tính lên **Google Drive** (`https://drive.google.com/drive/folders/1Xl8OZ7i1bOKf7000xbUBYLPcxVb2qvRD` $\rightarrow$ tự động vào đúng thư mục môn học `PTA/PTB/GA/GB...` $\rightarrow$ tạo thư mục Lớp $\rightarrow$ tạo thư mục từng Học viên), lấy link Google Drive của từng bạn và tự động dán vào ô **Đường dẫn liên quan** (`src/lib/playwright/spck-drive-uploader.ts`, `POST /api/spck/upload-drive`).
  * [x] Tự động đẩy sản phẩm Web (`.html/.css/.js`) của học viên lên kho **GitHub Pages** dùng chung (`https://github.com/Banhtalon/WEB_PRODUCT_SHOW.git` $\rightarrow$ `https://banhtalon.github.io/WEB_PRODUCT_SHOW/<Mã-Lớp>/<Tên-Học-Viên>/`) và tự động gắn **Link Web Chạy Thử** vào ô **Đường dẫn liên quan** (`src/lib/github/spck-web-deployer.ts`, `POST /api/spck/deploy-web`).
  * [x] Tự động tạo **Google Sheet Bảng chấm điểm buổi Demo** cho từng lớp (VD: `Bảng chấm điểm buổi Demo App Producer - Advanced`), lưu sẵn 10 mẫu chuẩn theo khóa (`data/config/demo-sheet-templates/*.xlsx`), kiểm tra cấu hình độc lập theo khóa (từ `v2.7.0` mở rộng áp dụng nộp SPCK cho tất cả các lớp bao gồm cả `PTB` và `CSB`; công cụ phụ chưa có mẫu riêng chỉ báo riêng không dùng nhầm mẫu `PTA` và không chặn nộp SPCK lên LMS), nhân bản mỗi học viên 1 tab riêng, tự động điền tên học viên và Ngày Demo theo **Buổi 14**, lưu vào thư mục bài của lớp trên máy tính và tải lên thư mục lớp trên Google Drive kèm nút Copy Link chia sẻ cho giám khảo chấm (`src/lib/playwright/spck-demo-sheet.ts`, `POST /api/spck/create-demo-sheet`).
  * [x] Tự động mở ngầm giao diện App của học viên để chụp hình toàn bộ các màn hình giao diện (`_spck_app_shots/`), dùng **AI Vision (`gemini-3.5-flash-lite`)** đánh giá chọn hình chụp App đẹp nhất làm **Thumbnail (ô trên)** kết hợp hình do Owner tải lên (`_spck_owner_uploads/`), và đưa toàn bộ các hình chụp giao diện còn lại vào **ô Hình ảnh sản phẩm (ô dưới)** (`src/lib/local-files/spck-app-screenshotter.ts`, `POST /api/spck/capture-screenshots`).
  * [x] Tích hợp **Cổng Thu Bài Học Sinh Trực Tuyến** (`src/lib/student-portal/student-portal-server.ts`, `GET/POST /api/spck/student-portal`): Giáo viên bấm 1 nút lấy Link Internet (`*.trycloudflare.com`) / Link Wi-Fi lớp học / Mã QR gửi cho học sinh $\rightarrow$ Học sinh chọn tên và tải thư mục/file sản phẩm lên $\rightarrow$ Hệ thống tự động lưu vào thư mục lớp trên máy giáo viên, tự động khóa `studentId` 100% và tự động đẩy thẳng lên Google Drive kèm gắn Link Drive vào ô `Đường dẫn liên quan`.
  * [x] Bảng Ghép nối & Kiểm tra trực quan từng học viên: Cột xác nhận `studentId`, trạng thái khớp thư mục, số ảnh, số file đính kèm, ô nhập/sửa Link Youtube & Link dự án, ô sửa Tiêu đề và Bình luận cuối khóa.
  * [x] Nút "AI Soạn Nhận Xét Cuối Khóa Cả Lớp".
  * [x] Quy trình 3 bước tinh gọn cho **Buổi 12**, **Buổi 13**, **Buổi 14** (`v2.6.0`): Chọn buổi 1 lần ở đầu trang; Bảng tóm tắt gọn hiển thị 3 cột trạng thái riêng cho Buổi 12 / 13 / 14 (`sessionResultsJson`, giữ lịch sử khi sửa nháp và hiển thị `"Chưa xác định"` cho dữ liệu cũ thiếu bằng chứng buổi) + nút `"Chi tiết"` mở khung chỉnh sửa đầy đủ; gom công cụ phụ và mục `"Chuẩn bị Demo"` vào phần thu gọn theo ngữ cảnh; thay nhiều nút nộp trùng lặp bằng **1 nút chính `"Nộp N bài — Buổi X"`** kèm báo cáo đầy đủ bài Thành công / Lỗi / Bỏ qua và nút thử lại. Tự động phân giải máy chủ tải file `resources.mindx.edu.vn` (`45.117.83.246`), tự động lấy ảnh **Logo MindX (`data/config/default-spck-thumbnail.png`)** làm Thumbnail mặc định khi thư mục học viên không có ảnh, tự động mở rộng thẻ `Xem chi tiết trang` và bắt đúng GraphQL `CreateStudentWork`/`UpdateStudentWork` trên `https://lms-api.mindx.edu.vn/`.

> **✅ ĐIỀU KIỆN NGHIỆM THU GIAI ĐOẠN 6:**
> 1. Bảng Ghép nối khóa chặt `localFolderPath ↔ studentId`, không bao giờ upload nhầm bài giữa các học viên.
> 2. Mọi link Youtube và Đường dẫn liên quan đều được bấm `+ Thêm` đầy đủ.
> 3. Chạy lại tác vụ sau khi ngắt mạng không tạo thêm `Sản Phẩm Học Viên 02` trùng lặp và đối chiếu sau lưu khớp 100%.

---

### GIAI ĐOẠN 7: MÀN HÌNH QUẢN LÝ GIÁO TRÌNH (SYLLABUS), BAREM, LIVE LOG DRAWER & ĐÓNG GÓI SỬ DỤNG
> **Mục tiêu:** Cung cấp giao diện trực quan để giáo viên tự quản lý Nội dung bài học, Câu hỏi & Barem chấm điểm, Quick Tags, Mẫu Zalo ngay trên Web App; theo dõi tiến trình bot chạy thời gian thực và khởi động nhanh bằng 1 cú click đúp.

* [x] **TASK-7.1:** Xây dựng Giao diện Màn hình 4 (`/syllabus-config`) — **Kho Nội Dung Bài Học, Barem Chấm Điểm & Mẫu Zalo**:
  * [x] Giao diện thêm/sửa/xóa nhanh nội dung từng buổi học của từng khóa (`PTA/PTB/PTI`, `JSB/JSA/JSI`, `SB/SA/SI`, `GB/GA/GI`, `ROB`, `CSI`...) với số buổi linh hoạt để lưu cố định vào Web App.
  * [x] Giao diện lưu sẵn Câu hỏi bài tập và Barem điểm chi tiết (từng tiêu chí + thang điểm) của từng buổi để tái sử dụng cho mọi lớp cùng khóa.
  * [x] Giao diện tùy chỉnh bộ thẻ đánh giá nhanh (`Quick Tags`) và Mẫu thông báo Zalo (`Zalo Broadcast Template`).
* [x] **TASK-7.2:** Xây dựng thanh **Live Automation Log / Status Drawer** (`src/components/live-log-drawer.tsx`):
  * [x] Kết nối Server-Sent Events (SSE) với `TaskQueue` để hiển thị trạng thái thời gian thực khi Playwright đang chạy (VD: *"Đang tải bài của Phạm Thiện Hoàng Khang...", "Đã khóa submissionId #1289", "Đã bấm Lưu và đối chiếu VERIFIED trên LMS"*).
  * [x] Nút **"Dừng khẩn cấp (Stop Bot)"** giúp giáo viên ngắt ngay các tác vụ tiếp theo trong hàng đợi bất cứ lúc nào (giữ nguyên trạng thái các bản ghi đã `VERIFIED` trước đó).
* [x] **TASK-7.3:** Tạo bộ file khởi chạy nhanh 1 chạm cho giáo viên:
  * [x] Tạo `start-bot.bat` (trên Windows) và `start-bot.command` (trên macOS) tự động kiểm tra môi trường, khởi chạy server local `http://127.0.0.1:3000` và mở trình duyệt để giáo viên chỉ cần click đúp chuột là dùng ngay.

> **✅ ĐIỀU KIỆN NGHIỆM THU GIAI ĐOẠN 7:** Giáo viên thêm/sửa được Giáo trình và Barem ngay trên giao diện Web; thanh Live Log hiển thị mượt mọi bước chạy của Playwright kèm nút Stop hoạt động tức thì; click đúp file chạy nhanh mở thẳng ứng dụng thành công.

* [x] **AUDIT-R34:** Đã hoàn tất kiểm định độc lập Giai đoạn 7 (`TASK-7.1`..`TASK-7.3`) tại `docs/audits/round-34/REPORT.vi.md`; **ĐẠT (GO) toàn diện**. Toàn bộ kiểm thử tích hợp Phase 7 (`scripts/test-phase7.ts`), hồi quy Phase 6 (`scripts/test-phase6.ts`), hồi quy Phase 5 (`scripts/test-phase5.ts`) và kiểm tra kiểu tĩnh TypeScript (`tsc --noEmit --incremental false`) đạt 100% PASS (0 lỗi); bảo toàn nguyên vẹn `next-env.d.ts` (`B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000`) và toàn bộ hồ sơ kiểm toán `round-12`..`round-33`.
* [x] **AUDIT-R36:** Đã hoàn tất tái kiểm định độc lập Giai đoạn 5 tại `docs/audits/round-36/REPORT.vi.md`; **NO-GO cấp mã nguồn**: đóng 7/7 tình huống gốc R35-01..R35-07 nhưng phát hiện R36-01 (P2), cờ nháp cũ chặn Duyệt sau khi file đổi phiên bản. Các bộ tương ứng đúng vị trí R31 đạt 819/819, 221/221, 88/88, 4/4, 28/28; Phase 5 và TypeScript đạt; bộ R36 bổ sung đạt 9/10. Đã chạy đủ 10 lệnh yêu cầu, giữ rõ 4 đường dẫn không tồn tại và mã thoát đảo của 2 bộ dò cũ; không đổi chúng thành PASS. Giữ nguyên 1.691/1.691 tệp bảo vệ, gồm 1.611 hồ sơ R12–R35 và next-env.d.ts đúng hash; đã xóa bản sao TEMP cùng dữ liệu giả. Không sửa sản phẩm hoặc dùng dịch vụ/dữ liệu thật. Dấu [x] xác nhận hoàn tất kiểm định, chưa nghiệm thu TASK-5.x.

* [x] **AUDIT-R37:** Đã hoàn tất Closure Verification độc lập Giai đoạn 5 tại `docs/audits/round-37/REPORT.vi.md`; **GO cấp mã nguồn**, thay thế NO-GO của AUDIT-R36 trong phạm vi nguồn đã kiểm. Đóng 8/8 mã R35-01..R35-07 và R36-01; chạy đủ 11 cổng yêu cầu: R31 đạt 819/819, 221/221, 88/88, 4/4, 28/28; Phase5 đủ 8 nhóm, TypeScript 0 lỗi, core R35 3/3, UI/barem R35 hết tái hiện (giữ đúng mã thoát 1 lịch sử), R36 10/10. Giữ nguyên 1.738/1.738 tệp bảo vệ gồm 1.657 hồ sơ R12–R36 và next-env.d.ts đúng hash; đã xóa bản sao TEMP và dữ liệu giả. Không sửa sản phẩm, chưa nghiệm thu trình duyệt/LMS/Gemini/dữ liệu thật. Dấu [x] xác nhận hoàn tất kiểm định, không tự nghiệm thu vận hành TASK-5.x.


* [x] **AUDIT-R38:** Đã hoàn tất Adversarial Review độc lập Giai đoạn 6 (`TASK-6.1`..`TASK-6.5`) tại `docs/audits/round-38/REPORT.vi.md`; **NO-GO cấp mã nguồn**: 12 nhóm lỗi mới (5 P1, 7 P2), bộ mới **24/41 PASS, 17 FAIL**. Phase 6, Phase 5 (8 nhóm) và TypeScript 0 lỗi đạt; R32 nguyên bản bị chặn bởi tên TEMP, bản tương thích chỉ đổi assertion tên đạt **67/67**. Bảo toàn **1786/1786 tệp**, gồm **70/70 src/scripts**, **1705/1705 hồ sơ R12–R37** và next-env.d.ts đúng hash. Đã xóa bản sao TEMP cùng fixture ngoài do lượt này tạo; không sửa sản phẩm, không dùng LMS/Gemini/dữ liệu thật. Dấu [x] chỉ xác nhận hoàn tất kiểm toán, chưa nghiệm thu Giai đoạn 6.

* [x] **AUDIT-R39:** Đã hoàn tất Closure Verification độc lập Giai đoạn 6 (`TASK-6.1`..`TASK-6.5`) tại `docs/audits/round-39/REPORT.vi.md` (phiên `gpt-6.1-sol` high `01a15d27-1e12-74b1-8c68-a32a42165bca`); **GO cấp mã nguồn Giai đoạn 6**, thay thế NO-GO của AUDIT-R38. Đóng toàn bộ **12/12 nhóm phát hiện (`R38-01`..`R38-12`)**: bộ đối kháng R38 đạt **41/41 PASS**, bộ tương thích R32 đạt **67/67 PASS**, Phase 6 (`scripts/test-phase6.ts`) đạt 100%, Phase 5 (`scripts/test-phase5.ts`) đạt 100%, TypeScript 0 lỗi (`evidence/gates.json`). Bảo toàn **1.829/1.829 tệp bảo vệ** gồm hồ sơ `round-12`..`round-38` và `next-env.d.ts` đúng hash (`B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000`); đã dọn sạch bản sao TEMP (`evidence/cleanup.json`).

* [x] **AUDIT-R40:** Đã hoàn tất Adversarial Review độc lập Giai đoạn 7 (`TASK-7.1`..`TASK-7.3`) tại `docs/audits/round-40/REPORT.vi.md` (phiên `gpt-6.1-sol` high `01a15d6d-6cce-7e71-bd59-ad68bac6237a`); **NO-GO cấp mã nguồn**: phát hiện **8 nhóm lỗi (`R40-01`..`R40-08`)** qua bộ kiểm thử đối kháng `docs/audits/round-40/adversarial.mjs` (**35/65 PASS, 30 FAIL**); Phase 7 (`scripts/test-phase7.ts`), Phase 6 (`scripts/test-phase6.ts`), Phase 5 (`scripts/test-phase5.ts`) và TypeScript (`tsc --noEmit --incremental false`) đạt 100%. Dấu [x] chỉ xác nhận hoàn tất kiểm toán, cần khắc phục đủ 8 mã `R40-01`..`R40-08` và kiểm chứng lại ở `AUDIT-R41`.


* [x] **AUDIT-R41:** Đã hoàn tất Closure Verification độc lập Giai đoạn 7 (`TASK-7.1`..`TASK-7.3` — phiên `gpt-6.1-sol` high `01a15d81-c7a8-7712-b923-694059964444`): bộ đối kháng R40 đạt **65/65 PASS, 0 FAIL**, đóng toàn bộ **8/8 nhóm lỗi gốc (`R40-01`..`R40-08`)**; Phase 7/6/5 PASS 100%, TypeScript 0 lỗi, cả 5 cổng exit 0 (`docs/audits/round-41/REPORT.vi.md`, `REGRESSION_MATRIX.md`, `evidence/results.json`). Ghi nhận trong lúc chạy có một phiên Codex Desktop khác đang sửa song song `save-comments.ts` (Giai đoạn 4) và `round-12/independent-results.json`; toàn bộ tệp của Giai đoạn 7 giữ nguyên 100%, TEMP đã dọn sạch và `next-env.d.ts` giữ đúng SHA-256 (`B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000`).

* [x] **AUDIT-V2.3.1:** Đã chạy kiểm định độc lập bằng Codex CLI (`gpt-6.1-sol` chế độ `xhigh`) cho toàn bộ các tính năng mới & các bản vá (`v2.1.0`..`v2.3.0`: Google Drive SPCK Uploader, GitHub Pages Web Deployer, AI Nhận xét SPCK tự nhiên, Nộp SPCK kèm Logo MindX mặc định & DNS Split), khắc phục toàn diện các phát hiện bảo mật/toàn vẹn dữ liệu (`F01`..`F20`), sửa triệt để selector điền `Đường dẫn liên quan (Link)` (`input#inputRelativeUrlName` / `input#inputRelativeUrl` tách biệt khỏi `input#inputYoutube`) kèm bảo toàn `relatedLinksJson` khi quét lại thư mục SPCK, và tinh gọn giao diện Màn hình 3 (`/final-project`) + thanh điều hướng (`layout.tsx`); toàn bộ kiểm thử `tsc --noEmit --incremental false`, `scripts/test-phase5.ts`, `scripts/test-phase6.ts` và `scripts/test-phase7.ts` đạt 100% PASS.


* [x] **UPDATE-V2.6.0 (Tinh gọn Quy trình Nộp SPCK Buổi 12/13/14 — Kiểm thử Giả lập Cục bộ):** Đã tinh gọn màn hình `/final-project` thành 3 bước rõ ràng (Chọn lớp $\rightarrow$ Chọn buổi 12/13/14 1 lần ở đầu trang $\rightarrow$ Chọn thư mục; Bảng tóm tắt gọn có 3 cột kết quả riêng cho Buổi 12/13/14 trong `spck_uploads.sessionResultsJson`, giữ nguyên lịch sử buổi trước khi sửa nháp, hiển thị `"Chưa xác định"` cho dữ liệu cũ thiếu bằng chứng buổi; 1 nút chính `"Nộp N bài — Buổi X"` báo đủ bài Thành công / Lỗi / Bỏ qua trên tổng số bài đã chọn; sửa khai báo `TaskJobType` `"CLEAR_SPCK"` / `"SPCK_DEMO_SHEET"` và kiểm tra nghiêm ngặt `sessionNumber` trong `clearSessionSpck`). Đã vượt qua 100% kiểm thử giả lập cục bộ (`tsc --noEmit --incremental false`, `scripts/test-phase6.ts` 5/5 nhóm, `verify-phase6.mjs` 67/67, `adversarial.mjs` 41/41, `scripts/test-phase5.ts`, `scripts/test-phase7.ts`); chưa chạy nộp/xóa trên LMS thật, Google Drive thật hoặc GitHub Pages thật.

* [x] **UPDATE-V2.7.0 (Cập nhật Quy trình Nộp SPCK Buổi 12–13–14 theo Giai đoạn 1 & Giai đoạn 2 của MindX — Kiểm thử Giả lập Cục bộ; chưa nghiệm thu LMS/Gemini/Drive/GitHub thật):**
  * **Chặng 0 — Chuẩn bị và tạo điểm khôi phục:**
    * [x] Đọc `PROJECT_STATE.md`, `MINDX_AUTOMATION_PLAN.md`, `CHANGELOG.md` và đối chiếu mã nguồn hiện tại.
    * [x] Ghi nhận toàn bộ thay đổi đang có và tạo bản sao lưu nhất quán (`scratch/backup_spck_v270_20261024/mindx_bot.db` đạt `integrity_check: ok` + 83 file `src/scripts`).
    * [x] Ghi mã kiểm tra `baseline-manifest.json`; bảo vệ `next-env.d.ts` và hồ sơ `docs/audits/round-12`..`round-41`.
    * [x] Tạo dữ liệu giả cho Coding, Robotics, `PTB`, `CSB`, ba buổi `12/13/14` và dữ liệu lịch sử cũ trong bộ kiểm thử (`scripts/test-spck-v270.ts`).
  * **Chặng 1 — Tách dữ liệu theo buổi (`spck_session_submissions`) và sửa lỗi lịch sử:**
    * [x] Tạo bảng `spck_session_submissions` (lớp + học viên + buổi) kèm giữ dữ liệu nguồn cũ để tương thích và khôi phục.
    * [x] Chuyển kết quả có bằng chứng buổi từ `sessionResultsJson` sang bảng mới; giữ nguyên bằng chứng kết quả cũ (`Thiếu bản lưu nội dung cũ`, cờ `hasLegacyUnknownSessionHistory`) độc lập với trạng thái nháp để không mất nhãn `"Chưa xác định"` khi sửa nháp hoặc nộp Buổi 14; dữ liệu lịch sử hỏng hiện `"Cần kiểm tra"`.
    * [x] Tách thao tác cập nhật nháp / cập nhật tài nguyên chạy chậm khỏi thao tác ghi kết quả nộp kèm kiểm tra `expectedVersion` (`draftSeq`), chống ghi đè mất lịch sử, cô lập trạng thái duyệt riêng từng buổi và chống chuyển nhầm lịch sử khi ghép lại học viên (nguyên tử trong transaction SQLite).
  * **Chặng 2 — Chuẩn hóa tiêu đề tự động gắn buổi/giai đoạn và nhận xét AI theo giai đoạn:**
    * [x] Tự động gắn hậu tố buổi/giai đoạn vào tiêu đề theo mẫu `<Tên sản phẩm> — Buổi 12 (GĐ1)`, `<Tên sản phẩm> — Buổi 13 (GĐ1)`, `<Tên sản phẩm> — Buổi 14 (GĐ2)` (không lặp hậu tố khi đổi buổi, kiểm tra giới hạn 100 ký tự không cắt âm thầm tên sản phẩm, tự động lấy/giữ tên sản phẩm không chặn duyệt).
    * [x] Truyền `sessionNumber` (`12 | 13 | 14`) xuyên suốt tới bộ tạo nhận xét AI (`spck-comment.ts`): Buổi 12 (GĐ1: Tiến độ hiện tại & phần cần hoàn thiện), Buổi 13 (GĐ1: Tiến độ hiện tại, phần đã bổ sung & phần cần hoàn thiện, chỉ so sánh với Buổi 12 khi có dữ liệu thực của Buổi 12), Buổi 14 (GĐ2: Kết quả sản phẩm, nội dung cập nhật & hạn chế nếu có; lọc câu bịa thuyết trình/làm việc nhóm khi thiếu dữ kiện).
  * **Chặng 3 — Hoàn thiện 7 nhóm thông tin và mở khóa cho tất cả các lớp (gồm `PTB` và `CSB`):**
    * [x] Chỉ bắt buộc 3 trường có dấu `*` (`Tiêu đề*`, `Ảnh thumbnail*`, `Bình luận của giáo viên*`); ưu tiên ảnh 16:9, gắn nhãn rõ cho ảnh mặc định Logo MindX / ảnh phục dựng / loại đường dẫn (`Chạy thử sản phẩm`, `Mã nguồn/Tải xuống`, `Tài liệu khác`); hỗ trợ đóng gói ZIP cho file mô hình Robotics, kiểm tra mã băm byte (`SHA-256`) và đối tượng `latestData` để thay thế file cùng tên đã đổi nội dung trên LMS và báo rõ khi vượt giới hạn `10 ảnh / 10 file / 5 video / 5 link`.
    * [x] Bỏ miễn nộp SPCK cho `PTB` và `CSB` trên toàn bộ luồng; công cụ phụ thiếu cấu hình báo riêng, không chặn luồng nộp LMS chính.
  * **Chặng 4 — Hoàn thiện giao diện 3 bước, xem lại bản nộp từng buổi & Kiểm thử `T01`–`T16` + Review Codex CLI (`gpt-6.1-sol` `xhigh`):**
    * [x] Đổi buổi tự lưu nháp đang sửa rồi nạp đúng bản nháp của buổi mới; có nút `"Dùng tài nguyên mới nhất"` và khung xem lại nội dung lần nộp thành công của từng buổi (`lastVerifiedSnapshot`).
    * [x] Đạt kiểm thử giả lập cục bộ `T01`–`T16` (`scripts/test-spck-v270.ts`), `tsc --noEmit --incremental false`, `test-phase5.ts`, `test-phase6.ts`, `test-phase7.ts` và đạt **GO (đóng 9/9 phát hiện `F01`–`F09`)** ở Vòng 4 kiểm định độc lập bằng Codex CLI (`gpt-6.1-sol` `xhigh`, phiên `01a16d96-5b27-7063-9429-d17ca0ed9074`); chưa nghiệm thu trên trình duyệt thật và dịch vụ LMS/Gemini/Drive/GitHub thật.

* [x] **UPDATE-V2.7.2 (Sửa AI nhận xét Buổi 12/13, Ảnh Owner làm Thumbnail, Ảnh chụp App/Web `960×540`, Nhập Playlist YouTube cho lớp Robotics):**
  * [x] Sửa lỗi AI soạn nhận xét Buổi 12/13 bị bỏ (`staleIgnored`) khi Buổi 14 đã `VERIFIED`: chỉ coi là xung đột khi trạng thái thay đổi trong lúc AI chạy; banner báo đúng số bài soạn được / thiếu dữ kiện / lỗi; quét lại thư mục giữ nguyên Quick Tags, ghi chú, nhận xét trên màn hình và đánh dấu đúng `isDirty = true` khi giữ dữ liệu chưa lưu từ màn hình.
  * [x] Ảnh đại diện ưu tiên ảnh Owner: `_spck_owner_uploads/thumb_*` → ảnh Owner tải lên → ảnh Owner để sẵn ở thư mục gốc mà code học viên không dùng (`findOwnerProvidedRootPhotos`, gộp chuỗi ghép động `"ban" + "ner"` trong Python/JS và yêu cầu dấu hiệu ảnh Owner rõ ràng khi dự án có mã gọi ảnh động) → ảnh giao diện AI chọn → Logo MindX (tuyệt đối không lấy ảnh YouTube `_spck_youtube_frames` làm Thumbnail); ảnh chụp giao diện chuyển xuống ô ảnh bổ sung, không bao giờ tự bỏ ảnh của Owner; bổ sung `resolveSafeStaticFile` chặn liên kết thư mục (junction/symlink) trỏ ra ngoài thư mục học viên.
  * [x] Ảnh chụp Web dàn trang `1440×810` nhưng xuất `960×540` (vừa khít khung xem ảnh LMS, không cắt chữ/thanh cuộn ngang), ép hiệu ứng `fadeIn`/`data-aos`/`animation-timeline` hiện đầy đủ; ảnh App PyQt6 thu vừa trọn vẹn vào khung `960×540` (`spck-image-normalizer.ts`).
  * [x] Lớp Robotics: `POST /api/spck/import-youtube` + mục **1D** trên `/final-project` — dán 1 link Playlist lớp (hoặc `Tên - link`), tự khớp học viên theo tiêu đề video (ưu tiên khớp nguyên họ tên trước điểm gần đúng, giữ chữ `"Thế"`, báo lại trùng tên/xung đột/không khớp), gắn link riêng, lấy đúng 2 khung hình HD thuyết trình `960×540` qua HTTP thuần vào ô ảnh bổ sung, Thumbnail = ảnh Owner hoặc Logo MindX; lưu DB nguyên tử trong transaction SQLite kèm tự động xóa ảnh mới tạo nếu phát sinh lỗi ghi; giao diện giữ nguyên chữ đang gõ và chặn phản hồi đến muộn kéo lùi `draftVersion`; buổi đã duyệt/đã nộp không bị thay đổi.
  * [x] Đạt `scripts/test-spck-v272.ts` (**16/16 kịch bản V01–V16 PASS**), `scripts/test-spck-v270.ts` (**16/16 PASS**), `scripts/test-phase6.ts` (**PASS 100%**), `tsc --noEmit --incremental false` (**0 lỗi**) và đạt kiểm định độc lập **Codex CLI (`gpt-6.1-sol` `xhigh`) Vòng 3 — GO (đóng 10/10 phát hiện `F01`–`F10` và 3/3 điểm `R2-01`..`R2-03`)** (`docs/audits/v272/CODEX_REVIEW_ROUND3.md`); đã chụp lại thực tế lớp `VT-JSB15` (6/6 học viên dùng ảnh thuyết trình Owner để sẵn làm Thumbnail, ảnh giao diện `960×540` và đủ 6 nhận xét Học bạ ở Buổi 12). Chưa nghiệm thu nhập Playlist trên lớp Robotics thật (lớp `VT-C4K-SB28` chưa có trong dữ liệu bot).

---

### GIAI ĐOẠN 8 (v3.2.0): TRANG RIÊNG DỰ ÁN CUỐI KHÓA TEACHING (`/teaching-projects`) — TỰ ĐỘNG TẠO DỰ ÁN, SOẠN 5 PHẦN CÔNG VIỆC (`20% × 5 = 100%`) & BÁO CÁO TIẾN ĐỘ HỌC VIÊN
> **Mục tiêu:** Tự động hóa toàn diện quy trình tạo Dự án cuối khóa (`SPCK - <tên lớp>`), lấy ngày Bắt đầu & Kết thúc từ LMS, tạo đủ 5 phần công việc chuẩn (`20% × 5 = 100%`, `Deadline = Ngày kết thúc khóa`) bằng Mẫu khóa học hoặc AI (`gemini-3.5-flash-lite`) và cập nhật Báo cáo tiến độ học viên trên `https://teachingmindx.top/hocsinh.php` trong một tab trang riêng biệt (`/teaching-projects`).

* [x] **TASK-8.1 (SQLite `teaching_final_projects`, Khóa `contentHash` SHA-256 & Kiểm tra Nghiêm ngặt Không Tự Sửa Ngầm):**
  * [x] Bổ sung bảng `teaching_final_projects` và `teachingProjectRepo` trong `src/lib/db/sqlite.ts` (hỗ trợ biến môi trường `MINDX_DB_PATH` và `closeDb()` để chạy kiểm thử cô lập 100% không chạm `data/mindx_bot.db`).
  * [x] Bổ sung `computeTeachingProjectHash` (SHA-256) và `validateTeachingProjectForApproval`: bắt buộc đúng 5 phần công việc, mỗi phần có tiêu đề chung (`taskName`), mô tả chi tiết (`description`), tỷ trọng nguyên dương (`Number.isInteger(weightPercent)`, tổng = `100%`), `deadline` hợp lệ (`YYYY-MM-DD`, không nhận `0000-00-00`), và `assignedStudentIds` không rỗng; không tự làm tròn số lẻ (`20.4%`), không tự cắt mảng `> 5` công việc và không tự điền lại danh sách học viên rỗng khi lưu nháp/duyệt (`F08`).
  * [x] Tự động hạ trạng thái từ `APPROVED` / `VERIFIED` về `WAITING_APPROVAL` khi nội dung thay đổi (`newHash !== contentHash`); bổ sung `syncRemoteMetadata` để cập nhật metadata từ Teaching mà không ghi đè bản nháp cục bộ hoặc tăng `draftVersion` (`F04`).
* [x] **TASK-8.2 (Đồng bộ Ngày Bắt đầu & Ngày Kết thúc Khóa học từ MindX LMS):**
  * [x] Bổ sung `resolveClassDateRangeInfo` và `ClassSyncer.fetchClassDatesFromLms` trong `src/lib/playwright/sync-class.ts` + `RunningClassItem.startDate` trong `src/lib/db/json-config.ts`.
  * [x] Ưu tiên phân tích ngày `YYYY-MM-DD` trước `DD/MM/YYYY` kèm kiểm tra ngày lịch thực tế (`parseClassDateToEndOfDayMs`: `2026-10-28` -> `28/10/2026`, từ chối `31/02/2026`) (`F10`).
  * [x] Khi quét trực tiếp bảng `/admin/classes` trên LMS, bắt buộc xác minh phản hồi API tìm kiếm lớp khớp mã lớp và đạt HTTP `200..299` (báo lỗi rõ nếu timeout hoặc HTTP `>= 400`, tuyệt đối không dùng dòng DOM cũ khi mạng lỗi) và chỉ ghi nhận `source: "LMS_LIVE"` khi trích xuất đủ cả `startDateIso` và `endDateIso` (`F11`).
* [x] **TASK-8.3 (Kho 5 Phần Công Việc Chuẩn Theo Bộ Môn & AI Generator `gemini-3.5-flash-lite`):**
  * [x] Xây dựng `src/lib/gemini/teaching-project-generator.ts` với bộ 5 công việc chuẩn (`20% × 5 = 100%`) cho 6 nhóm môn (`GAMEMAKER`, `SCRATCH`, `PYTHON_APP`, `WEB`, `COMPUTER_SCIENCE`, `ROBOTICS`) và hàm `mergeExistingTeachingTasksWithStandardFive` tự động giữ `taskId` cũ, sửa `deadline = 0000-00-00` về `endDate`, bù các công việc còn thiếu lên đủ 5 phần và gắn cờ `wasAutoCompleted = true` (kể cả khi tự điền `defaultStudents` cho công việc rỗng) ở trạng thái `DRAFT` (`F02`).
  * [x] Tích hợp Gemini (`gemini-3.5-flash-lite`) đọc `courses_syllabus.json`: thực hiện ẩn danh PII đa tầng 4 lượt trên toàn bộ danh sách học viên từ SQLite (`students` + `teaching_final_projects`) — ưu tiên thay thế toàn bộ họ tên đầy đủ trước, sau đó đến tổ hợp 2 từ, tên gọi 1 từ và họ/tên đệm đứng cạnh `STUDENT_XX`, kèm ẩn danh email/SĐT trên mọi trường prompt (`teacherHint`, `courseName`, `classCode`); trả về `INSUFFICIENT_INFO` khi thiếu cả giáo trình, nhóm môn và gợi ý của giáo viên (`F06`).
* [x] **TASK-8.4 (Playwright / HTTP Service Đồng bộ `teachingmindx.top/hocsinh.php` & 5 API Routes):**
  * [x] Xây dựng `src/lib/playwright/teaching-project-service.ts` thực thi qua `SequentialTaskQueue` đơn luồng, gọi trực tiếp `https://teachingmindx.top/hocsinh.php` (`get_project`, `get_students`, `get_tasks`, `get_task_progress`, `create_project`, `save_task`, `delete_task`, `update_task_progress`).
  * [x] Thực hiện **Read-after-Write Verification** 100% cho cả 4 trường thông tin dự án (`project_name`, `start_date`, `end_date`, `description` trên cả dự án mới tạo lẫn dự án đã có `projectId > 0`) và 5 phần công việc trước khi đánh dấu `VERIFIED` (`F01`).
  * [x] Trong `updateTaskProgressOnTeaching`: kiểm tra dự án đã `APPROVED`/`VERIFIED`, đối chiếu `taskId` nằm trong cả danh sách 5 công việc đã duyệt ở SQLite lẫn dự án trên Teaching, từ chối công việc có danh sách phân công rỗng và kiểm tra `studentId` thuộc danh sách phân công trước khi ghi (`F05`); đối chiếu `Read-after-Write` bắt buộc khóa `taskId_studentId` tồn tại tường minh trong `verifiedProgress` (`F09`).
  * [x] Xây dựng 5 API routes (`/api/teaching-projects`, `/api/teaching-projects/sync`, `/api/teaching-projects/generate-ai`, `/api/teaching-projects/fetch-lms-dates`, `/api/teaching-projects/progress`) bảo vệ `verifyLocalRequest` (`127.0.0.1`) và bắt buộc `expectedVersion` (`HTTP 400` khi thiếu, `HTTP 409` khi lệch phiên bản ở mọi nhánh) (`F07`).
* [x] **TASK-8.5 (Giao diện `/teaching-projects`, Tương phản Sáng/Tối & Kiểm thử Cô lập `TP-01`..`TP-06`):**
  * [x] Thêm tab **`🚀 Dự án Teaching`** (`/teaching-projects`) trên `src/components/top-navbar.tsx` và xây dựng trang `src/app/teaching-projects/page.tsx` gồm 3 khu vực: (1) Thông tin dự án & lấy ngày LMS, (2) Bộ 5 phần công việc chuẩn `20% × 5 = 100%` (Mẫu chuẩn / AI, tinh gọn bỏ chú thích dài dòng và mặc định thu gọn kèm nút **`Xem chi tiết / Ẩn chi tiết`**), (3) Bảng báo cáo tiến độ học viên với nút mốc `20% / 40% / 60% / 80% / 100%` và nút **`Mở trang Báo cáo Tiến độ (VT-...)`** (`https://teachingmindx.top/duan_tiendo_hocsinh.php?class_code=VT-<mã_lớp>`).
  * [x] Khóa mọi thao tác bất đồng bộ theo `activeLoadSeqRef` & `loadedClassCodeRef` (`F03`), mặc định `forceRefresh = false` khi mở trang/đổi lớp để bảo vệ bản nháp (`F04`), và dùng toàn bộ nhãn/nút `.mindx-dark-keep` nền đậm (`bg-*-700/800`, `hover:bg-*-800`, `text-white`) đạt độ tương phản WCAG AA $\ge 4.5:1$ ở cả trạng thái thường và `hover` trên 4 tổ hợp Sáng/Tối (`F12`).

> **✅ ĐIỀU KIỆN NGHIỆM THU GIAI ĐOẠN 8 (`v3.2.0`):** Giáo viên chọn hoặc nhập mã lớp trên `/teaching-projects`, tự động có Tên dự án `SPCK - <tên lớp>`, Ngày bắt đầu/kết thúc chuẩn từ LMS và đủ 5 phần công việc (`20% × 5 = 100%`, `Deadline = Ngày kết khóa`); bấm Duyệt & Đẩy lên `teachingmindx.top/hocsinh.php` đạt `VERIFIED` sau đối chiếu Read-after-Write; cập nhật nhanh tiến độ `20%..100%` chính xác; toàn bộ 6 nhóm kiểm thử `scripts/test-teaching-project-v320.ts` (`TP-01`..`TP-06`) chạy trên DB cô lập đạt 100% PASS và giữ nguyên SHA-256 của `data/mindx_bot.db`.

---

### GIAI ĐOẠN 9 (`v3.3.0`): PHIẾU ĐIỂM TỔNG KẾT CHUẨN TEACHING (`/homework-grader`) — TỰ ĐỘNG LẤY ĐIỂM BTVN, CHECKPOINT 1 & 2, CUỐI KHÓA DEMO TỪ LMS & ĐỒNG BỘ TEACHING
> **Mục tiêu:** Tự động gom điểm BTVN (Lý thuyết + Thực hành 1 & 2), Điểm Checkpoint 1 & 2 (`Lý thuyết`, `Thực hành`, `Năng lực`) và Điểm Final DEMO (Buổi 14: `Sản phẩm`, `Năng lực`) từ MindX LMS và dữ liệu Web Owner; dựng thành **Phiếu Điểm Tổng Kết** ngay trên Màn hình 2 (`/homework-grader`) giống hệt 100% trang `teachingmindx.top/diem-tong-ket.php` (hỗ trợ cả lớp Lập trình và lớp Robotics, bộ lọc, sửa điểm trực tiếp, 3 biểu đồ, chụp ảnh dán Zalo, xuất Excel) và hỗ trợ nút 1 chạm đẩy đồng bộ điểm lên `teachingmindx.top/hocsinh.php`.

* [x] **TASK-9.1 (SQLite `class_report_cards` & Quản lý Điểm Sửa Tay / Chống Ghi Đè):** Stage 1 Round 4 closure **GO** (`docs/audits/v330/CODEX_STAGE1_ROUND4.md`, đóng `7/7` phát hiện `F01`–`F07`).
  * [x] Bổ sung bảng `class_report_cards` và `reportCardRepo` trong `src/lib/db/sqlite.ts` (khóa theo `classId`, hỗ trợ biến môi trường `MINDX_DB_PATH` để kiểm thử cô lập).
  * [x] Lưu tách biệt `lmsSnapshotJson` (điểm gốc cào từ LMS) và `manualOverridesJson` (các ô điểm giáo viên tự nhập bù / sửa tay), kèm `teachingSyncStatus`, `teachingSyncedAt`, `draftVersion`.
  * [x] Khi cào lại dữ liệu từ LMS: tự động cập nhật `lmsSnapshotJson` mới nhưng **bảo toàn 100% các ô điểm giáo viên đã sửa tay** trong `manualOverridesJson` (có nút khôi phục từng ô về điểm LMS gốc); kiểm tra nghiêm ngặt `expectedVersion` (`HTTP 400` khi thiếu, `HTTP 409` khi lệch phiên bản).
* [x] **TASK-9.2 (Bộ Công Thức Tính Điểm & Xếp Hạng Chuẩn Teaching `src/lib/report-card/report-card-calculator.ts`):** Stage 1 Round 4 closure **GO** (`docs/audits/v330/CODEX_STAGE1_ROUND4.md`).
  * [x] Quy đổi điểm BTVN về thang 5: $\text{norm} = \text{round2}\left(\frac{\text{raw}}{\text{maxScore}} \times 5\right)$, đánh dấu `.btvn-low` cho các ô có điểm quy đổi `< 2.50` (kể cả `0.00`), tính `Số bài nộp` và `Điểm TB` (trên cả thang 5 và thang gốc).
  * [x] Tính `Điểm TB (LT, TH)` của từng kỳ CP (nếu chỉ có 1 trong 2 cột thì lấy cột hiện có); `Tổng CP1` = $\text{round2}(0.4 \times \text{TB(LT, TH)}_{CP1} + 0.6 \times \text{NL}_{CP1})$; `Tổng CP2` = $\text{round2}(0.4 \times \text{TB(LT, TH)}_{CP2} + 0.6 \times \text{NL}_{CP2})$.
  * [x] Tính `Tổng Final` = $\text{round2}(0.6 \times \text{Sản phẩm} + 0.4 \times \text{NL}_{Final})$.
  * [x] Tính `Điểm TB (CP1, CP2)` (trung bình cộng `Tổng CP1` và `Tổng CP2`, nếu mới có 1 kỳ CP thì lấy điểm kỳ đó); `TBCK` = $\text{round2}(0.4 \times \text{TB(CP1, CP2)} + 0.6 \times \text{Tổng Final})$ (phần chưa có tính là `0`).
  * [x] Xếp hạng `A / B / C / D` và Xếp loại `Xuất sắc / Giỏi / Khá / Đạt / Yếu / Kém`: kiểm tra điều kiện đủ 8 cột thành phần (`CP1_LT`, `CP1_TH`, `CP1_NL`, `CP2_LT`, `CP2_TH`, `CP2_NL`, `FINAL_SP`, `FINAL_NL`) đều có điểm `> 0` cho Hạng A ($\ge 4.50$) và Hạng B ($4.00 \le \text{TBCK} < 4.50$); Hạng C ($2.50 \le \text{TBCK} < 4.00$ hoặc $\ge 4.00$ nhưng khuyết/0 điểm cột thành phần); Hạng D ($\text{TBCK} < 2.50$).
* [x] **TASK-9.3 (Nâng Cấp Bộ Thu Thập Điểm LMS Toàn Diện cho Lập Trình & Robotics `src/lib/playwright/scrape-scores.ts`):** Stage 2 Round 4 closure **GO** (`docs/audits/v330/CODEX_STAGE2_AUDIT_ROUND4.md`, đóng `10/10` phát hiện `S2-01`..`S2-09` & `R2-01`).
  * [x] **Hỗ trợ buổi có 2 bài Thực hành (`PRACTICE_TASK1` + `PRACTICE_TASK2`):** Trong `FindStudentSubmissionByClass`, lấy tất cả bài nộp thực hành (`PRACTICE_TASK1`, `PRACTICE_TASK2`...) đã chấm (`MARKED`) của buổi đó và tính trung bình cộng làm điểm `Thực hành` của buổi học (thay vì chỉ lấy `PRACTICE_TASK1`).
  * [x] **Chuẩn hóa danh sách buổi BTVN:** Lọc bỏ các cột `lesson.type === "CHECKPOINT"` khỏi bảng BTVN và ẩn các buổi trùng buổi Checkpoint (`Buổi 5`, `Buổi 9` đối với khóa Lập trình, giữ chuẩn 7 buổi BTVN `1, 2, 3, 4, 6, 7, 8`).
  * [x] **Trích xuất tự động điểm Checkpoint 1, Checkpoint 2 & Final DEMO từ `GetClassById.slots`:**
    * Lớp Lập trình: đọc CP1 từ **Buổi 5** (`slots[4]`) và CP2 từ **Buổi 9** (`slots[8]`) — lấy `checkpoint.checkpointScore` (`Lý thuyết`), `checkpoint.practiceScore` (`Thực hành`), và trung bình cộng 9 ô `type === "RATE"` có `grade > 0` (`Năng lực`), kèm dự phòng từ 2 cột `Bài kiểm tra` trong `FindStudentSubmissionByClass`.
    * Lớp Robotics (`isRoboticsClassCode`): **bỏ qua tab `Chấm bài` (`#tab-3`)** (không có BTVN), chỉ đọc trực tiếp CP1 từ **Buổi 4** (`slots[3]`), CP2 từ **Buổi 8** (`slots[7]`) và Final từ **Buổi 14** (`slots[13]`) trong phần Nhận xét (`GetClassById.slots`).
    * Giai đoạn Final DEMO (Buổi 14): tự động ghép điểm từ bảng `spck_session14_evaluations` trong SQLite (`demoTotalScore` $\rightarrow$ `Sản phẩm`, `competencyTotalScore` $\rightarrow$ `Năng lực`) và `GetClassById.slots[13]` trên LMS.
* [x] **TASK-9.4 (Đồng Bộ 1 Chạm Lên Trang Teaching `src/lib/playwright/teaching-report-card-sync.ts` & API Routes):** Stage 3 Round 3 closure **GO** (2026-10-29); nghiệm thu mã hiện tại trong phạm vi kiểm định, chưa xác nhận chạy Teaching thật. Báo cáo: `docs/audits/v330/CODEX_STAGE3_ROUND3.md`.
  * [x] Xây dựng `teaching-report-card-sync.ts` chạy qua `SequentialTaskQueue` đơn luồng: lấy danh sách học sinh (`get_students_of_class`), khớp học viên an toàn, kiểm tra đầu bài (`get_class_exercises`), tự động khai báo bù đầu bài còn thiếu (`add_multi_exercise`: BTVN cho lớp Lập trình, `cp1`, `cp2`, `final`), đẩy điểm (`save_scores`) và thực hiện **Read-after-Write Verification** (`get_scores`) đối chiếu khớp 100%.
  * [x] Xây dựng các API routes `/api/report-card` (`GET`, `POST`, `PUT`) và `/api/report-card/sync-teaching` (`POST`) bảo vệ `validateLocalRequest` (`127.0.0.1`).
* [x] **TASK-9.5 (Giao Diện Phiếu Điểm Tổng Kết Chuẩn Teaching & Tinh Gọn Màn Hình 2):** Stage 4 Round 3 closure **GO** (`docs/audits/v330/CODEX_STAGE4_ROUND3.md`, đóng `7/7` phát hiện `S4-01`..`S4-06` & `R2-01`, `959/959` ca probe bổ sung PASS).
  * [x] Xây dựng `src/components/teaching-report-card-view.tsx` và nâng cấp `src/app/homework-grader/page.tsx`:
    * Khung Header Phiếu Điểm chuẩn MindX + **Khối 1: Bảng Điểm BTVN** (tự động ẩn với lớp Robotics) + **Khối 2: Bảng Tổng Kết Điểm Đánh Giá Chi Tiết (Thang 5)**.
    * Nút gạt *Hiển thị điểm gốc (thang 100) / Điểm quy đổi (thang 5)*, Bộ lọc buổi BTVN, Bộ lọc giai đoạn (*Tất cả*, *Chỉ CP1*, *Chỉ CP2*, *CP1 & CP2*), sắp xếp theo cột.
    * Cho phép bấm sửa / nhập bù trực tiếp từng ô điểm trên bảng (tự động tính lại tổng & xếp hạng tức thì).
    * Hộp thoại *Công thức*, **3 Hộp thoại Biểu đồ (`Biểu đồ CP1`, `Biểu đồ CP2`, `Biểu đồ DEMO`)** có đường Mốc Đạt `2.5` + nút *Copy hình*, và 2 nút **`Copy ảnh BTVN`** / **`Copy ảnh Tổng kết`** chụp PNG sắc nét dán thẳng vào Zalo.
    * Nút Xuất Excel (`.xlsx`) / Copy Google Sheets và nút **Đẩy đồng bộ điểm lên Teaching** + mở nhanh trang `teachingmindx.top/diem-tong-ket.php`.
  * [x] Tinh gọn giao diện: Bỏ phần giao diện thừa *"Tự chấm BTVN theo Barem"* trên `/homework-grader`, ẩn tab *"Barem chấm bài"* trên `/syllabus-config`, cập nhật tiêu đề trên `/` và `top-navbar.tsx` (giữ nguyên các module backend ngầm để bảo toàn 100% tương thích với các bộ kiểm thử cũ).
* [x] **TASK-9.6 (Kiểm Thử Tự Động Cô Lập `RC-01`..`RC-06` & Review Độc Lập Codex CLI `gpt-6.1-sol` `high`):** Stage 4 Round 3 closure **GO** (`docs/audits/v330/CODEX_STAGE4_ROUND3.md`).
  * [x] Xây dựng `scripts/test-report-card-v330.ts` chạy trên DB cô lập (`TEMP`) kiểm tra toàn diện 6 nhóm kịch bản `RC-01`..`RC-06` (gồm đối chiếu toán học với dữ liệu thật của `VT-C4K-GB40`, `VT-C4K-GA22`, `VT-JSB16`, `VT-C4K-GA38`, `VT-ROB-ARMA12`).
  * [x] Chạy Review độc lập sau mỗi chặng bằng **Codex CLI (`gpt-6.1-sol` `high`)** đạt **GO** trên cả 4 chặng (`CODEX_STAGE1_ROUND4.md`, `CODEX_STAGE2_AUDIT_ROUND4.md`, `CODEX_STAGE3_ROUND3.md`, `CODEX_STAGE4_ROUND3.md`) và đảm bảo toàn bộ cổng hồi quy (`tsc --noEmit --incremental false`, `test-phase4-codex-repros.ts`, `test-phase5.ts`, `test-phase6.ts`, `test-phase7.ts`, `test-teaching-project-v320.ts`) đạt 100% PASS.

## Independent audit: v3.3.0 Phase 9 Stage 1 (2026-10-29)

- **NO-GO** for TASK-9.1 / TASK-9.2: seven findings cover non-atomic version locking, raw-score validation, incomplete content hashing, drift during SAVING/FAILED, optional approval versions, decimal rounding, and snapshot class identity.
- Installed native TypeScript compiler: PASS (exit 0). Extracted RC-01/RC-02 math checks: 139 assertions PASS. Both requested `npx` commands could not launch because Node/npx is inaccessible to this session; the complete SQLite RC-03 suite remains unverified.
- Production `data/mindx_bot.db` SHA-256 unchanged: `93CDF719342E7B7AF6A49C2A96382842C8ECBDD161319063BB2FBC65EE4DF5EA`. No application source, test source or production database was modified by the auditor.
- Findings and evidence: [Stage 1 audit](docs/audits/v330/CODEX_STAGE1_AUDIT.md). TASK-9.1 and TASK-9.2 remain pending acceptance.

## Independent audit: v3.3.0 Phase 9 Stage 2 (2026-10-29)

- **NO-GO for TASK-9.3:** nine open findings (six P1, three P2) cover failed/delayed class capture overwriting scores, cross-class response acceptance, suppressed snapshot-save failures, lost DOM fallback scores, unsafe identity precedence, omitted CRM pupils, checkpoint fallback identity, zero DEMO handling, and small-payload BTVN filtering.
- Fresh TypeScript, RC-01 through RC-04, and Phase 4 VM regression commands all PASS (exit 0). An independent harness reproduced 11 defect observations using mocked browser events and real temporary SQLite repositories where required. RC-04 currently lacks scraper/persistence integration coverage.
- Production DB SHA-256 remained `93CDF719342E7B7AF6A49C2A96382842C8ECBDD161319063BB2FBC65EE4DF5EA`; all SQLite tests were isolated via `MINDX_DB_PATH`. No application or existing test source was modified; audit artifacts and project tracking only.
- Report and acceptance conditions: [Stage 2 audit](docs/audits/v330/CODEX_STAGE2_AUDIT.md). Evidence: `docs/audits/v330/stage2/`. TASK-9.3 remains pending acceptance.

## Independent audit: v3.3.0 Phase 9 Stage 2 Round 2 (2026-10-29)

- **NO-GO for TASK-9.3:** six findings CLOSED (`S2-01`, `S2-03` through `S2-06`, `S2-09`); three remain partially fixed/OPEN (`S2-02`, `S2-07`, `S2-08`). New P2 regression `R2-01`: blank DEMO fields become zero.
- All four requested verification commands PASS (exit 0). Additional independent probes reproduce stale responses overwriting fresh persisted scores, unidentified checkpoints being assigned to CP1, and ungraded/blank DEMO values becoming zero; real SQLite rollback and both-output identity/roster checks also pass.
- Production DB and running-class cache SHA-256 values are unchanged. All SQLite executions used disposable DB overrides. No application code or existing test code was edited by this audit.
- Report: [Stage 2 Round 2 audit](docs/audits/v330/CODEX_STAGE2_AUDIT_ROUND2.md). Evidence: `docs/audits/v330/stage2-round2/`. TASK-9.3 remains pending acceptance.

## Independent audit: v3.3.0 Phase 9 Stage 2 Round 3 (2026-10-29)

- **NO-GO for TASK-9.3: eight of ten findings CLOSED.** S2-08 and R2-01 are now closed; the six previously closed findings remain closed. S2-02 and S2-07 remain partially fixed/OPEN.
- All five requested commands PASS (exit 0), including both prior probes. Additional independent cases reproduce an old class response accepted before the first fresh request (CP1 4 -> 5 in both real SQLite stores, Coding and Robotics) and an unnamed checkpoint assigned to CP1/CP2 from its array position.
- Production DB and running-class cache hashes, lengths and modification times are unchanged; all executions used disposable DB/cache overrides. Application and existing test/probe source were not edited.
- Report: [Stage 2 Round 3 audit](docs/audits/v330/CODEX_STAGE2_AUDIT_ROUND3.md). Evidence: `docs/audits/v330/stage2-round3/`. TASK-9.3 remains pending acceptance; no live LMS or later Phase 9 acceptance is implied.

## Independent audit: v3.3.0 Phase 9 Stage 2 Round 4 (2026-10-29)

- **GO for the TASK-9.3 Stage 2 closure gate: all 10 findings CLOSED (`S2-01`..`S2-09`, `R2-01`).** S2-02 now unconditionally requires the exact fresh request object for both GraphQL operations; the legacy mocks emit request before response using that same object. S2-07 resolves checkpoint identity from the original trimmed source title, keeping unnamed checkpoints at positions 5/9 missing.
- All six fresh verification commands PASS (exit 0): TypeScript, RC-01 through RC-04/RC-04C, the original Stage 2 probe, Round 2 probe, Round 3 probe, and Phase 4 compatibility suite. Probe observations: 11/11, 10/10, and 6/6 CLOSED records respectively (not assertion counts). Former Round 3 failures now meet closure expectations.
- All executions received isolated DB/cache overrides. All 118 protected source/script/data/probe/report files retain their SHA-256, lengths and modification times; production DB/cache are unchanged. Temporary files/directories were deleted, and prior observation JSON contents restored. Only this report and the three required tracking documents were changed.
- Report: [Stage 2 Round 4 closure audit](docs/audits/v330/CODEX_STAGE2_AUDIT_ROUND4.md). Earlier NO-GO entries remain historical. This accepts the requested closure scope only; live LMS/Teaching operation, Stage 1 re-acceptance and later Phase 9 tasks are not certified. The named Claude reviewer is unavailable; Codex performed the direct audit.

## Independent audit: v3.3.0 Phase 9 Stage 3 (2026-10-29)

- **NO-GO for TASK-9.4: 9 findings (5 HIGH, 3 MEDIUM, 1 LOW; no CRITICAL).** Reproduced wrong-student numeric-ID matching, inactive-student writes, incomplete normalized/null readback, failed exercise reads triggering declarations, optional service version checks, malformed JSON returning 500, missing/ignored PUT actions, writes after Stop, and a state-transition hardening gap.
- All three requested commands PASS (exit 0): TypeScript, RC-01..RC-05, and Phase 4 compatibility. Independent probe: 40 observation records, comprising 29 bug observations grouped into the 9 findings and 11 passing control records; these are not assertion counts.
- Commands used TEMP DB/cache overrides. The unchanged RC suite ran in a TEMP workspace mirror because it replaces its DB override internally. All 117 pre-existing protected source/script/data files retain SHA-256, length and last-write timestamps; production DB/cache are unchanged. No application or existing test code was edited, and no live LMS/Teaching requests were made.
- Report: [Stage 3 audit](docs/audits/v330/CODEX_STAGE3_AUDIT.md). Evidence/probe: `docs/audits/v330/stage3/`. TASK-9.4 remains pending acceptance; the earlier Stage 2 closure decision remains unchanged.

## Independent audit: v3.3.0 Phase 9 Stage 3 Round 2 (2026-10-29)

- **TASK-9.4 remains NO-GO:** `S3-02`, `S3-05`, `S3-06`, `S3-09` CLOSED for the audited sync path; `S3-01`, `S3-03`, `S3-04`, `S3-07`, `S3-08` PARTIALLY FIXED / OPEN.
- Remaining acceptance work: reject failed explicit Teaching bindings before weaker fallback; require equal two-decimal normalized scores; require literal success=true mutation acknowledgment; reject conflicting score payload sources; keep Stop/timeout active through response-body decoding and underlying request cancellation.
- Four requested commands freshly PASS; original Stage 3 probe 40 PASS observations; supplemental probe 72 observations (55 CLOSED / 17 OPEN across five findings). All executions use TEMP DB/cache; 145 pre-existing protected files including production data remain unchanged. No production fixes were made by the auditor.
- Report and closure evidence: [Stage 3 Round 2](docs/audits/v330/CODEX_STAGE3_ROUND2.md), `docs/audits/v330/stage3-round2/`. Rerun the mandatory commands and supplemental probe after correction; acceptance requires no remaining OPEN boundaries. Earlier TASK-9.3 Stage 2 GO is unchanged.

## Independent audit: v3.3.0 Phase 9 Stage 3 Round 3 (2026-10-29)

- **TASK-9.4 Stage 3 closure GO:** all nine findings S3-01 through S3-09 CLOSED. The five Round 2 blockers are resolved and the four previously closed findings remain closed for the audited sync/API path.
- Five requested verification commands freshly PASS (exit 0): TypeScript, RC-01..RC-05, Phase 4, original Stage 3 probe and Round 2 closure probe. Observations: 40 PASS; 72 CLOSED / zero OPEN. New independent probe: 101 CLOSED observations, including initial/retry JSON body Stop/timeout across all five transport methods. Final TypeScript PASS; counts are observation records, not assertion totals.
- All executions used TEMP DB/cache/observation overrides; all 202 pre-existing protected files, including production data and earlier audit evidence, remain unchanged. Auditor added evidence and tracking only, with no application fixes or live remote writes.
- Report: [Stage 3 Round 3](docs/audits/v330/CODEX_STAGE3_ROUND3.md). Evidence: `docs/audits/v330/stage3-round3/`. Acceptance covers current working files and supersedes TASK-9.4 Round 2 NO-GO. Earlier TASK-9.3 Stage 2 GO is unchanged; TASK-9.5/TASK-9.6 and live Teaching verification are not accepted by this audit.

## Independent audit: v3.3.0 Phase 9 Stage 4 (2026-10-29)

- **TASK-9.5 / TASK-9.6 remain pending: NO-GO.** Six OPEN findings: `S4-01` stale class/revision responses and filter contamination; `S4-02` actions before class-matched loading completes; `S4-03` stale editor adopts a newer version; `S4-04` empty BTVN selection selects all; `S4-05` failed scrape/read announced as successful; `S4-06` formula/rank guidance contradicts calculation.
- Acceptance requires class/generation guards for every asynchronous action, a matching-loaded-record invariant for writes/exports, editor-bound versions, explicit empty-selection behavior, propagated scrape/read results, and shared accurate formula/rank explanations. Add behavioral regressions for each case and rerun the requested gates.
- Five requested gates freshly PASS (TypeScript, RC-01..RC-06, Phase 4, Phase 5, Phase 7); independent probe collected 32 observation records with six findings. All tests used TEMP DB/cache overrides; neither production data file was opened, hashed, copied or modified. Application and existing test source unchanged.
- Report/acceptance details: [Stage 4 audit](docs/audits/v330/CODEX_STAGE4_AUDIT.md). Evidence: `docs/audits/v330/stage4/`. Earlier TASK-9.3/TASK-9.4 closure decisions remain unchanged; live Teaching layout/clipboard operation remains outside verified acceptance.

## Independent audit: v3.3.0 Phase 9 Stage 4 Round 2 (2026-10-29)

- **TASK-9.5 / TASK-9.6: NO-GO.** Five Round 1 findings CLOSED (`S4-02`..`S4-06`); `S4-01` remains PARTIALLY FIXED / OPEN (HIGH): a late mutation can replace a newer same-class GET and export stale scores. New MEDIUM regression `R2-01`: overlapping operation types strand the earlier operation's busy flag.
- All six requested commands freshly PASS (exit 0), including the updated original Stage 4 probe (29 records: 15 closure records, 14 controls). Supplemental independent probe: 82 observation records, 60 CLOSED/control and 22 OPEN across the two blockers; counts are not assertion totals. Both blockers additionally reproduced through actual local API handlers and disposable SQLite. Server stale-write protection still returns HTTP 409.
- All runtime tests ran in a TEMP mirror with TEMP DB/cache overrides; neither production DB nor running-class cache was opened, hashed, copied or modified. All 135 recorded source/script/configuration/original-probe files retain hashes, sizes and modification times. No application or existing test/probe edits, and no live remote writes.
- Report and closure criteria: [Stage 4 Round 2](docs/audits/v330/CODEX_STAGE4_ROUND2.md). Evidence: `docs/audits/v330/stage4-round2/`. Earlier Stage 2/3 closure decisions remain unchanged. Native browser rendering/clipboard and live Teaching/LMS operation remain outside verified acceptance. The named Claude reviewer is unavailable; Codex performed the independent audit directly.

## Independent audit: v3.3.0 Phase 9 Stage 4 Round 3 (2026-10-29)

- **GO for the TASK-9.5 / TASK-9.6 Stage 4 closure gate: all seven findings CLOSED (`S4-01`..`S4-06`, `R2-01`).** All mutation payloads now honor the monotonic version floor and acceptance-gated success effects; per-operation busy ownership releases completed actions without disturbing pending ones. Read failures close editors, and opening during loading/unmatched class is blocked.
- All seven requested commands freshly PASS (exit 0): TypeScript, original Stage 4 probe, Round 2 probe, RC-01..RC-06, Phase 4, Phase 5 and Phase 7. Original probe: 29 records (15 CLOSED, 14 controls); Round 2: 82 CLOSED / zero OPEN. New independent Round 3 probe: **959 CLOSED / zero OPEN**, including 864 cross-owner pairing scenarios, 6 disabled same-owner controls, 60 A-B-A/new-operation cases, 24 payload-rejection cases and 5 cleanup boundaries. Counts are observation records, not unique assertions.
- Actual TEMP SQLite/API replay retains v4/theory 5 and TSV `5.00` after delayed v3; stale writes return HTTP 409. Actual approve/reset completes at v5 / WAITING_APPROVAL with both busy flags false.
- All command data/allowlist overrides point below Windows TEMP; runtime gates used a TEMP mirror, including Phase 7 configuration writes. Neither production DB nor running-class cache was opened, hashed, copied or modified. All 166 enumerated pre-existing source/script/config/original-probe/metadata files retain hashes, lengths and timestamps. No application or existing test/probe edits or live remote writes.
- Report: [Stage 4 Round 3 closure audit](docs/audits/v330/CODEX_STAGE4_ROUND3.md). Evidence: `docs/audits/v330/stage4-round3/`. Supersedes Round 2 NO-GO for this closure scope; prior Stage 2/3 acceptance is unchanged. Native rendering/clipboard, live LMS/Teaching operation and broader unrun release gates remain outside acceptance. The designated Claude reviewer is unavailable; Codex performed the independent audit directly. Broader task checkboxes are not marked fully complete by this scoped closure.

