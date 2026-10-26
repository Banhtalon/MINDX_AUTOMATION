# PROJECT_STATE.md — TỔNG QUAN NHANH & TIẾN ĐỘ HIỆN TẠI (DÀNH CHO AI AGENT)

> **Cập nhật lần cuối:** 2026-10-25
> **Mục đích:** Giúp AI Agent nắm bắt 100% kiến trúc, trạng thái hiện tại, bản đồ file và các đặc thù thực tế của MindX LMS chỉ trong **1 lần đọc** trước khi tra cứu chi tiết trong `@MINDX_AUTOMATION_PLAN.md`.

---

## 1. TỔNG QUAN HỆ THỐNG (EXECUTIVE SNAPSHOT)

- **Tên dự án:** MindX Automation Bot (`v2.7.2` — chi tiết lịch sử thay đổi tại `@CHANGELOG.md`)
- **Chức năng chính:** Trợ lý tự động hóa chạy cục bộ (`http://127.0.0.1:3000`) hỗ trợ Giáo viên MindX thực hiện 4 luồng nghiệp vụ:
  1. **Màn hình 1 (`/session-comments`):** Đồng bộ lớp/học viên từ LMS, chọn Quick Tags 5 cấp độ, AI (`gemini-3.5-flash-lite`) soạn nhận xét 3 gạch đầu dòng in đậm + Thông báo Zalo 2 phần, tự động đẩy nhận xét học viên + `Summary` + `Homework` lên LMS.
  2. **Màn hình 2 (`/homework-grader`):** Cào bảng điểm đa trang xuất Excel/Google Sheets & Tự động tải file bài nộp đa môn (`.py`, `.ipynb`, `.ui/.qss`, `.html/.css/.js`, `.zip`, `.sb3`, `.yyz/.gml`, ảnh/PDF) về chấm theo Barem kèm bằng chứng code.
  3. **Màn hình 3 (`/final-project`):** Quy trình 3 bước nộp Sản phẩm cuối khóa (SPCK) áp dụng cho tất cả các lớp (bao gồm cả `PTB` và `CSB`): **(Bước 1)** Chọn lớp ($\ge$ Buổi 12) $\rightarrow$ Chọn buổi nộp (`Buổi 12 — GĐ1` / `Buổi 13 — GĐ1` / `Buổi 14 — Tổng kết cuối khóa`) 1 lần ở đầu trang $\rightarrow$ Chọn thư mục và kiểm tra đúng học viên; **(Bước 2)** Chuẩn bị & xem lại bài trong bảng tóm tắt gọn (lưu riêng bản nháp, phiên bản `draftVersion`, nội dung đã duyệt và bản lưu thành công `lastVerifiedSnapshotJson` của từng buổi trong bảng `spck_session_submissions`; tự động gắn hậu tố tiêu đề `— Buổi 12 (GĐ1)` / `— Buổi 13 (GĐ1)` cho Buổi 12–13 và giữ tiêu đề sạch không ghi `Giai đoạn 2` / `GĐ2` ở Buổi 14, kiểm tra $\le 100$ ký tự; chỉ bắt buộc 3 trường có dấu `*` gồm `Tiêu đề*`, `Ảnh thumbnail*`, `Bình luận của giáo viên*`; AI nhận xét đúng nội dung từng buổi và tuyệt đối không ghi chữ `Giai đoạn 2` / `GĐ2` trong phần nhận xét AI; có nút `"Dùng tài nguyên mới nhất"` và khung xem lại nội dung đã nộp của từng buổi); **(Bước 3)** Nộp các bài đã chọn bằng 1 nút chính rõ ràng (`"Nộp N bài — Buổi X"`), đối chiếu mã kiểm tra byte (`SHA-256`) để thay thế file cùng tên đã đổi nội dung trên LMS và báo cáo đầy đủ bài thành công / bài lỗi / bài bị bỏ qua kèm lý do.
  4. **Màn hình 4 (`/syllabus-config`) & Live Log Drawer:** Quản lý kho Giáo trình (Syllabus), Barem chấm điểm, Quick Tags, Mẫu Zalo và theo dõi tiến trình Playwright thời gian thực (SSE + nút Stop khẩn cấp).
- **Khởi chạy nhanh:** Click đúp `MindX Automation Bot.lnk` ngoài Desktop hoặc chạy `start-bot.bat` (Windows) / `start-bot.command` (macOS).

---

## 2. TIẾN ĐỘ CÁC GIAI ĐOẠN (PHASE STATUS MATRIX)

| Giai đoạn | Nội dung trọng tâm | Trạng thái | Kiểm thử / Nghiệm thu |
| :--- | :--- | :---: | :--- |
| **Giai đoạn 0** | Khảo sát DOM/API thực tế của MindX LMS & Teaching | ✅ **HOÀN TẤT (100%)** | Đã xác minh trên lớp thật (`VT-C4K-GA38`, `VT-C4K-PTA12`...) |
| **Giai đoạn 1** | Khởi tạo Next.js (`127.0.0.1`), SQLite (`data/mindx_bot.db`), JSON Seed Data | ✅ **HOÀN TẤT (100%)** | 9 bảng SQLite + 4 file JSON cấu hình |
| **Giai đoạn 2** | Lõi Playwright Persistent Context, `TaskQueue` đơn luồng, Auto-Login & DNS Bypass | ✅ **HOÀN TẤT (100%)** | Đã xử lý triệt để lỗi DNS `*.mindx.edu.vn` & HMR Singleton |
| **Giai đoạn 3** | **Luồng 1:** Nhận xét buổi học (5 cấp độ), Thông báo Zalo (2 phần), Lưu LMS (`Summary` + `Homework` + Comment) | ✅ **HOÀN TẤT (100%)** | Đã chạy thực tế thành công trên LMS (`VT-C4K-GA38`) |
| **Giai đoạn 4** | **Luồng 2:** Cào bảng điểm đa trang & Xuất Excel / Copy Google Sheets | ✅ **HOÀN TẤT (100%)** | Đạt `AUDIT-R18` (GO) |
| **Giai đoạn 5** | **Luồng 3:** Tải bài tập kèm ID, Parser đa môn, AI chấm theo Barem & Lưu điểm LMS | ✅ **HOÀN TẤT (100%)** | Đạt `scripts/test-phase5.ts` & `AUDIT-R31` / `AUDIT-R37` (GO) |
| **Giai đoạn 6** | **Luồng 4:** Quét thư mục SPCK, tách dữ liệu theo Buổi 12/13/14 (`spck_session_submissions`), tiêu đề & AI nhận xét theo GĐ1/GĐ2, áp dụng cho mọi lớp (gồm `PTB`/`CSB`); **v2.7.2:** ảnh Owner làm Thumbnail, ảnh chụp App/Web `960×540`, nhập Playlist YouTube cho lớp Robotics | ✅ **HOÀN TẤT (100%)** | Đạt `scripts/test-spck-v270.ts` (T01–T16), `scripts/test-spck-v272.ts` (V01–V16), Review độc lập `gpt-6.1-sol xhigh` v2.7.2 Round 3 (**GO — 10/10 F01–F10 & 3/3 R2-01..R2-03 CLOSED**) và đã nghiệm thu thực tế `6/6 VERIFIED` trên MindX LMS thật (`VT-JSB15` Buổi 14) |
| **Giai đoạn 7** | **Màn hình 4:** Quản trị Giáo trình/Barem, Thanh Live Log SSE & Shortcut Desktop | ✅ **HOÀN TẤT (100%)** | Đạt `scripts/test-phase7.ts` & `AUDIT-R34` / `AUDIT-R41` (GO) |

---

## 3. BẢN ĐỒ FILE CỐT LÕI (FAST FILE MAP CHO AI AGENT)

### A. Giao diện Người dùng (Frontend Pages — `src/app/`)
- `src/app/page.tsx`: Dashboard tổng quan & lối tắt.
- `src/app/session-comments/page.tsx`: **Màn hình 1** — Nhận xét sau buổi học, chọn bài học từ Syllabus, tạo Thông báo Zalo (Phần 1 + Phần 2 qua ảnh BTVN) & Đẩy lên LMS.
- `src/app/homework-grader/page.tsx`: **Màn hình 2** — Bảng điểm tổng hợp & Chấm bài tập tự động theo Barem.
- `src/app/final-project/page.tsx`: **Màn hình 3** — Quy trình nộp SPCK 3 bước theo từng giai đoạn Buổi 12 (`GĐ1`), Buổi 13 (`GĐ1`), Buổi 14 (`GĐ2`) cho tất cả các lớp (kể cả `PTB` và `CSB`): lưu nháp và bản lưu thành công riêng từng buổi (`spck_session_submissions`), tự động gắn hậu tố buổi/giai đoạn vào tiêu đề, chỉ bắt buộc 3 trường `*` (`Tiêu đề*`, `Ảnh thumbnail*`, `Bình luận của giáo viên*`), nút `"Dùng tài nguyên mới nhất"`, khung xem lại nội dung đã nộp từng buổi và 1 nút chính `"Nộp N bài — Buổi X"`.
- `src/app/syllabus-config/page.tsx`: **Màn hình 4** — Quản lý Giáo trình, Barem, Quick Tags, Mẫu Zalo.
- `src/components/live-log-drawer.tsx`: Thanh Live Automation Log (SSE) + Nút Stop khẩn cấp.

### B. Bộ máy Tự động hóa Trình duyệt (Playwright — `src/lib/playwright/`)
- `src/lib/playwright/browser-manager.ts`: Quản lý Persistent Chromium (`./playwright-auth`), giữ Singleton qua `globalThis.__mindxBrowserManager` và tự động phân giải DNS `*.mindx.edu.vn` qua NS gốc (`115.84.177.33`, `103.109.43.92`).
- `src/lib/playwright/auth.ts`: Tự động đăng nhập SSO `id.mindx.edu.vn` / `lms.mindx.edu.vn`.
- `src/lib/playwright/lms-helpers.ts`: Mở Drawer lớp học (`openClassDrawer`), chuyển Tab (`switchDrawerTab`), xử lý phân trang & Toast.
- `src/lib/playwright/sync-class.ts`: Quét danh sách lớp đang dạy (`fetchRunningClasses`) và đồng bộ danh sách buổi học + học viên (`syncClass`).
- `src/lib/playwright/save-comments.ts`: Lưu nhận xét buổi học (HTML `<strong>` cho Quill `.ql-editor`), tự động điền `Summary` (Tiêu đề + Nội dung bài học) & `Homework` (Tóm tắt BTVN, tự động kích hoạt `ClickAwayListener` để lưu cho cả 2 mục), kèm cơ chế thử lại 3 lần khi mở/đóng hộp thoại `[role="dialog"]` và đối chiếu trực tiếp ở chế độ xem (`Auto Approved`) khi chạy lại để không bị nghẽn thao tác.
- `src/lib/playwright/spck-uploader.ts`: Nộp Sản phẩm cuối khóa (SPCK) vào tab `Comments` (`#tab-10`) $\rightarrow$ Slot **Buổi 12 / 13 / 14** $\rightarrow$ Modal `"Sản phẩm của học sinh"` (tự động vượt thanh cuộn ngang `.jss140` che nút bấm cuối bảng, tự động gom mã nguồn Web `.html/.css/.js/.txt` vào gói `.zip` chuẩn `spck_<studentId>_<hash8>.zip` để tránh `react-dropzone` từ chối ngầm, và đối chiếu `Read-after-Write` tương thích đồng thời với `resJson.link`, `latestData.attachmentUrls`, `latestData.imageUrl` của MindX LMS thật).
- `src/lib/playwright/spck-drive-uploader.ts`: Tự động điều hướng vào thư mục Google Drive gốc (`1Xl8OZ7i1bOKf7000xbUBYLPcxVb2qvRD` / thư mục môn học tương ứng `PTA`, `PTB`, `GA`, `GB`, `SB`...), tạo thư mục Lớp $\rightarrow$ tạo thư mục riêng cho từng Học viên, tải toàn bộ file dự án lên Google Drive, lấy link thư mục Drive của từng bạn và tự động điền vào `relatedLinksJson` (`Đường dẫn liên quan`) để nộp lên LMS.
- `src/lib/github/spck-web-deployer.ts`: Tự động đẩy thư mục dự án Web (`.html/.css/.js`) của từng học viên lên kho GitHub Pages dùng chung (`https://github.com/Banhtalon/WEB_PRODUCT_SHOW.git`), tạo đường dẫn chạy thử trực tiếp `https://banhtalon.github.io/WEB_PRODUCT_SHOW/<Mã-Lớp>/<Tên-Học-Viên>/` và tự động gắn vào `relatedLinksJson` (`Đường dẫn liên quan`) bên cạnh Link Google Drive.
- `src/lib/local-files/spck-app-screenshotter.ts`: Tự động mở ngầm giao diện ứng dụng của học viên — hỗ trợ cả **Python GUI (`.ui` PyQt6** với cơ chế **Khôi phục Ảnh bị thiếu 4 tầng**: sửa đường dẫn tương đối/đuôi file nội bộ $\rightarrow$ đối chiếu khung widget `.ui` cùng lớp $\rightarrow$ tra cứu tên file đặc trưng $\rightarrow$ tự vẽ bù icon/bản đồ/phông nền bằng `QtGui.QPainter`, kèm `WA_DontShowOnScreen = True`; **v2.7.2:** cửa sổ App được thu vừa trọn vẹn vào khung **16:9 `960×540`** trên nền mờ, không lẹm nút bấm) và **Website (`.html/.htm` cho các lớp `JSB`, `JSA`, `JSI`...** chạy trên máy chủ HTTP tĩnh cục bộ `127.0.0.1` + Playwright Chromium: **v2.7.2** dàn trang theo khổ máy tính `1440×810` nhưng xuất ảnh **`960×540`** (`deviceScaleFactor = 2/3`) vừa khít khung xem ảnh của MindX LMS — không còn bị cắt chữ hai bên/thanh cuộn ngang; tự động đưa mọi hiệu ứng `fadeIn`, `data-aos`, `animation-timeline: view()` về trạng thái hiện đầy đủ trước khi chụp; chụp đa trang và các phân đoạn trang chủ), lưu vào `<studentFolder>/_spck_app_shots/app_<NN>_<screenName>_<hash6>.png`. **Quy tắc Ảnh bìa v2.7.2 (ưu tiên ảnh Owner):** (1) `_spck_owner_uploads/thumb_*` $\rightarrow$ (2) ảnh Owner tải lên khác $\rightarrow$ (3) ảnh Owner để sẵn ở thư mục gốc của học viên mà code của học viên không dùng tới (VD `Demo.png`, ảnh thuyết trình) $\rightarrow$ (4) ảnh giao diện đẹp nhất do **Gemini Vision** chọn $\rightarrow$ (5) Logo MindX; toàn bộ ảnh chụp giao diện còn lại vào **`screenshotsJson` (ô dưới, tối đa 10 ảnh — không bao giờ tự bỏ ảnh của Owner)** và tự động đồng bộ ngay vào bản nháp buổi đang chọn (nếu buổi đó chưa duyệt/chưa nộp).
- `src/lib/local-files/spck-image-normalizer.ts` **(v2.7.2)**: Chuẩn hóa ảnh về khổ an toàn của LMS **`960×540` (16:9)** bằng Chromium cục bộ cô lập (không mạng): chế độ `contain` (giữ trọn ảnh App trên nền mờ) và `cover` (cắt viền đen 4:3 của khung hình YouTube).
- `src/lib/local-files/spck-youtube-import.ts` & `src/app/api/spck/import-youtube/route.ts` **(v2.7.2 — Lớp Robotics)**: Owner dán **1 link Playlist YouTube của lớp** (kể cả `m.youtube.com/playlist?list=...`) hoặc từng dòng `Tên học viên - link`; bot đọc danh sách video + tiêu đề (`ytInitialData`, hỗ trợ cả `lockupViewModel` mới và `playlistVideoRenderer` cũ), bỏ mã lớp trong tiêu đề (`SB28-Gia Bách` $\rightarrow$ `gia bach`), khớp học viên (ưu tiên khớp nguyên họ tên trước khi dùng điểm gần đúng; trùng tên/2 video cùng 1 bạn/không khớp đều **báo lại, không tự gắn**), gắn link riêng vào `youtubeUrlsJson`, lấy **đúng 2 khung hình HD thuyết trình** (`i.ytimg.com/vi/<id>/maxres1|3.jpg`, dự phòng `sd/hq` và ảnh bìa video qua HTTP thuần — không mở trình duyệt tới YouTube) chuẩn `960×540` vào `<thư-mục-HV>/_spck_youtube_frames/` (học viên chưa có thư mục thì tạo `data/spck_youtube/<Lớp>/<studentId>/`, tự động khôi phục và xóa ảnh mới nếu ghi DB gặp lỗi), Ảnh bìa = ảnh Owner tải lên/để sẵn hoặc **Logo MindX** (không bao giờ lấy ảnh YouTube làm Thumbnail); buổi đã duyệt/đã nộp không bị thay đổi.
- `src/lib/playwright/spck-demo-sheet.ts`: Tự động tạo tệp Google Sheet / `.xlsx` **Bảng chấm điểm buổi Demo** cho từng lớp (VD: `Bảng chấm điểm buổi Demo App Producer - Advanced.xlsx`) từ tệp mẫu chuẩn theo từng mã môn (`data/config/demo-sheet-templates/<COURSE>.xlsx`, kiểm tra cấu hình độc lập theo khóa, không dùng mẫu khóa khác thay thế và không chặn luồng nộp SPCK lên LMS cho các lớp `PTB`/`CSB`), nhân bản mỗi học viên 1 tab riêng kèm tab `Phân bổ điểm`, tự động điền tên học viên và Ngày Demo là ngày của **Buổi 14**, lưu vào thư mục SPCK của lớp và tải lên thư mục lớp trên Google Drive (`https://docs.google.com/spreadsheets/d/<fileId>/edit?usp=sharing`) để chia sẻ cho giám khảo chấm.
- `src/lib/student-portal/student-portal-server.ts` & `src/app/api/spck/student-portal/route.ts`: Máy chủ **Cổng Thu Bài Học Sinh Trực Tuyến** cô lập (bảo vệ bằng khóa `sessionToken`, tự động tạo Link Internet toàn cầu qua `Cloudflare Quick Tunnel` + Link mạng LAN nội bộ phòng học + Mã QR), cho phép học sinh tự chọn tên trong danh sách lớp và tải cả thư mục dự án hoặc file lẻ lên $\rightarrow$ tự động lưu vào đúng thư mục `<Thư-mục-Lớp>/<Họ-Tên-Học-Viên>/` trên máy giáo viên, tự động khóa `studentId` (`matchScore = 1.0`, `isConfirmedByTeacher = 1`) và tự động đẩy thẳng lên Google Drive kèm gắn Link Drive vào `relatedLinksJson`.
- `src/lib/playwright/scrape-scores.ts`, `download-submissions.ts`, `grade-worker.ts`: Cào bảng điểm, tải bài nộp và điền điểm chấm bài.

### C. Trí tuệ Nhân tạo & Đọc File (`src/lib/gemini/` & `src/lib/file-parsers/`)
- `src/lib/gemini/comment-generator.ts`: Sinh nhận xét buổi học theo 5 cấp độ & tạo Thông báo Zalo 2 phần (đọc ảnh BTVN lọc `Not submitted`).
- `src/lib/gemini/homework-grader.ts` & `score-auditor.ts`: Chấm bài tập theo Barem có trích dẫn bằng chứng; cộng điểm bằng TypeScript.
- `src/lib/gemini/spck-comment.ts`: Sinh nhận xét SPCK ghi vào **Học bạ** cho Phụ huynh xem với giọng văn sư phạm, trang trọng, **không chào hỏi**; nêu rõ **sản phẩm của học viên có những gì** (đề tài, các màn hình giao diện, chức năng thực tế, kiến thức đã vận dụng) và **cần cải thiện gì**; tuyệt đối không dùng các nhãn quản lý nội bộ như `Giai đoạn 1`, `Giai đoạn 2`, `GĐ1`, `GĐ2`, `Buổi 12/13/14`; kiểm soát chặt chẽ chống bịa thuyết trình/làm việc nhóm/tiến độ.
- `.agents/skills/nhan-xet-hoc-sinh/SKILL.md`: Quy tắc nhận xét học sinh 5 cấp độ (1 ô duy nhất gồm 3 gạch đầu dòng in đậm, không ghi tên học sinh ở đầu).
- `.agents/skills/nhan-xet-hoc-sinh-zalo/SKILL.md`: Quy tắc Thông báo Zalo Tổng kết buổi học (Phần 1: 6 mục súc tích, tịnh tiến +7 ngày) & Nhận xét BTVN (Phần 2: chỉ xuất khi có ảnh BTVN).

### D. Cơ sở dữ liệu & Bảo mật (`src/lib/db/` & `src/lib/security/`)
- `src/lib/db/sqlite.ts`: SQLite (`data/mindx_bot.db`), kho tài nguyên chung `spck_uploads`, bảng theo buổi `spck_session_submissions` (`classId + studentId + sessionNumber`) & hàm kiểm tra `contentHash` / `computeSpckSessionApprovalHash` SHA-256.
- `src/lib/db/json-config.ts`: Đọc/ghi `data/config/*.json` và `data/running_classes.json`.
- `src/lib/security/path-allowlist.ts` & `local-guard.ts`: Bảo vệ chỉ nhận request từ `127.0.0.1` và kiểm soát thư mục được phép đọc trên ổ cứng (tự động cấp quyền cho thư mục giáo viên chọn qua Folder Browser).

---

## 4. CÁC ĐẶC THÙ THỰC TẾ CỦA MINDX LMS (CRITICAL LIVE LMS NOTES)

1. **Lỗi DNS `ERR_NAME_NOT_RESOLVED` khi bật Cloudflare WARP (`1.1.1.1`) & Máy chủ Tải File `resources.mindx.edu.vn`:**
   - Nameserver `ns4/5/6.bizflycloud.vn` của `mindx.edu.vn` thường trả `REFUSED` gây `SERVFAIL` trên `1.1.1.1`/`8.8.8.8`, chỉ `ns1/ns2` (`115.84.177.33`, `115.84.182.199`) phản hồi.
   - Lưu ý cực kỳ quan trọng: `lms.mindx.edu.vn`, `lms-api.mindx.edu.vn`, `id.mindx.edu.vn` trỏ về IP `103.109.43.92`, nhưng **máy chủ tải ảnh/file đính kèm SPCK (`resources.mindx.edu.vn`) trỏ về IP riêng `45.117.83.246`**.
   - `browser-manager.ts` tự động phân giải cả 2 IP này từ `115.84.177.33` và truyền `--host-resolver-rules=MAP resources.mindx.edu.vn 45.117.83.246, MAP *.mindx.edu.vn 103.109.43.92, MAP mindx.edu.vn 103.109.43.92` để tải file lên `https://resources.mindx.edu.vn/api/v1/resources` không bao giờ bị lỗi SSL (`ERR_CERT_AUTHORITY_INVALID`).
2. **Cấu trúc Tab `Comments` (`#tab-10`) trên MindX LMS:**
   - Các buổi học nằm trong thanh trượt ngang `#class-comments-slot-carousel-0` (Buổi 1) đến `#class-comments-slot-carousel-13` (Buổi 14).
   - Phía trên bảng học viên có 2 hộp thu gọn là **`Summary`** và **`Homework`**. Khi bấm đẩy nhận xét lên LMS, `save-comments.ts` tự động mở 2 hộp này, điền Tiêu đề + Nội dung bài học vào `Summary` và Tóm tắt BTVN vào `Homework`, sau đó click vào tiêu đề cột bảng học viên (`th:has-text("student")`) để kích hoạt `ClickAwayListener` tự lưu (`UpdateSlotComment`) — **tuyệt đối không click lại vào `#class-comments-slot-carousel-X` khi ô buổi học đó đang `.active`**, vì trên MindX LMS việc click lại vào slot đang `.active` sẽ chuyển slot về `.inactive` và ẩn toàn bộ bảng danh sách học viên bên dưới (đã xác minh và khắc phục trên lớp `VT-CSA04-HB` Buổi 1).
   - Khung nhập nhận xét học viên là **Quill Rich Text Editor (`.ql-editor`)**: phải nạp bằng DOM nodes (`<p>` và `<strong>`) từ cú pháp `**...**` để giữ nguyên định dạng **in đậm** khi lưu lên LMS.
3. **Cấu trúc Nộp SPCK Thực tế trên MindX LMS:**
   - MindX LMS **không có tab SPCK riêng biệt**. Cổng nộp SPCK nằm ngay trong tab **`Comments` (`#tab-10`)** tại **Buổi 12, Buổi 13 và Buổi 14** (cột thứ 3 `"Sản phẩm học viên"` $\rightarrow$ nút `"Sản phẩm của học sinh"` mở hộp thoại `.MuiDialog-root`).
   - Khi chọn file vào `react-dropzone` trong Modal SPCK, trình duyệt tải file ngay lập tức lên `POST https://resources.mindx.edu.vn/api/v1/resources` trước khi bấm `Save`. Khi bấm `Save`, LMS gọi GraphQL mutation `CreateStudentWork` / `UpdateStudentWork` tới `https://lms-api.mindx.edu.vn/`.
   - Trường `Ảnh thumbnail *` (`latestData.thumbnail`) là bắt buộc trên LMS: nếu thư mục dự án của học sinh không có hình ảnh riêng, `spck-scanner.ts` và `spck-uploader.ts` bắt buộc tự động lấy ảnh **Logo MindX (`data/config/default-spck-thumbnail.png`)** làm ảnh bìa (Thumbnail) mặc định. Các file giao diện không nằm trong `accept` trực tiếp của dropzone (như `.ui`, `.qss`) được tự động đóng gói `.zip` để tải lên hợp lệ.
   - Sau khi lưu thành công, thẻ `Sản Phẩm Học Viên 01` tự động thu gọn về trạng thái `Pending #1` (hiện nút `Xem chi tiết trang`); khi cập nhật lại (`reusedExistingItem01`), bot tự động bấm `Xem chi tiết trang` để mở rộng form trước khi điền.
   - **Phân biệt ô nhập `Youtube Video` và `Đường dẫn liên quan (Link)` trên Modal SPCK:** Ô YouTube có `id="inputYoutube"` (`placeholder="Nhập đường dẫn youtube tại đây"`), còn phần Đường dẫn liên quan có 2 ô `id="inputRelativeUrlName"` (`placeholder="Đặt tên đường dẫn"`) và `id="inputRelativeUrl"` (`placeholder="Nhập đường dẫn"`). Tuyệt đối không dùng selector chung `input[placeholder*="Nhập đường dẫn" i]` `.first()` vì sẽ khớp nhầm vào ô YouTube phía trên. Khi quét lại thư mục SPCK (`POST /api/spck/scan`), bắt buộc giữ nguyên các link Google Drive / GitHub Pages đã gắn trong `relatedLinksJson`.

---

## 5. QUY TẮC BẢO VỆ KIỂM THỬ HỒI QUY (REGRESSION GUARDRAILS)

- **Tệp bảo vệ tuyệt đối không sửa:** `next-env.d.ts` và toàn bộ thư mục `docs/audits/round-12` .. `docs/audits/round-41`.
- **Tương thích `uiHarness` của `round-38/adversarial.mjs`:** Trong `src/app/final-project/page.tsx`, luôn giữ nguyên thứ tự 5 hook `useState` đầu tiên (`classes`, `selectedClassId`, `students`, `folderPathInput`, `rows`) và dòng `\n  return (\n    <div className="space-y-6">`.
- **Tương thích `scripts/test-phase6.ts`:** Trong `src/lib/playwright/spck-uploader.ts`, giữ nguyên nhánh DOM giả lập (`[data-student-id]`) khi `options.skipNavigation === true`, và chạy nhánh Modal LMS thật khi điều hướng thực tế.
- **Lệnh kiểm tra nhanh sau khi sửa code:**
  - `npx tsc --noEmit --incremental false`
  - `npx tsx scripts/test-spck-v270.ts`
  - `npx tsx scripts/test-spck-v272.ts` (Ảnh Owner làm Thumbnail, ảnh chụp `960×540`, nhập Playlist YouTube lớp Robotics — V01–V08)
  - `npx tsx scripts/test-phase5.ts`
  - `npx tsx scripts/test-phase6.ts`
  - `npx tsx scripts/test-phase7.ts`
