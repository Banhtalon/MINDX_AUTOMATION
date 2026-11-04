# NHIỆM VỤ KIỂM ĐỊNH ĐỘC LẬP — BẢN VÁ LỚP WEB SPCK (GIỚI HẠN 10 FILE / 10 ẢNH LMS) & TINH GỌN MÀN 3 (`/final-project`)

Bạn là **Independent Quality & Safety Auditor (`gpt-6.1-sol` `high`)** kiểm định độc lập đợt nâng cấp **Tự động xử lý giới hạn 10 ảnh / 10 file LMS cho lớp Web SPCK & Tinh gọn Màn 3 (`/final-project`)** trong dự án **MINDX AUTOMATION BOT (`v3.4.0`)**.

## 1. PHẠM VI THAY ĐỔI CẦN KIỂM ĐỊNH
Hãy đọc và kiểm tra kỹ các tệp vừa được cập nhật:
1. `src/lib/local-files/spck-scanner.ts`:
   - Phát hiện dự án Web (`walkWebProject` sâu tối đa 3 cấp cho `.html`/`.htm`).
   - Tách biệt ảnh nguyên liệu làm Web (`images/`, `img/`, `Articles/`, `LCourses/`, `printer accessories/`... và các ảnh icon/asset gốc không phải ảnh Owner) khỏi `validImages` để không đẩy nhầm vào 10 ô *"Ảnh sản phẩm"* của LMS.
   - Tự động gom các tệp mã nguồn Web hợp lệ (`.html`, `.htm`, `.css`, `.js`, `.mjs`, `.json`, `.txt`, `.text`, `.md`, `.csv`, `.xml` không rỗng và không chứa byte null) thành 1 gói `<safeSlug>_web_package.zip` khi dự án Web vượt quá 10 tệp đính kèm hoặc tổ chức code trong thư mục con (`HTML/`, `CSS/`), đồng thời bỏ qua `*_web_package.zip` khi quét lại để tránh đóng gói lồng nhau.
2. `src/lib/github/spck-web-deployer.ts`:
   - Bổ sung `_spck_app_shots`, `_spck_owner_uploads`, `_spck_youtube_frames` vào `IGNORED_WEB_DIRS` và bỏ qua `*_web_package.zip` khi đẩy GitHub Pages.
   - Bổ sung `.jfif` và `.text` vào `ALLOWED_WEB_ASSET_EXTENSIONS`.
   - Mở rộng `findStudentWebRootAndEntryHtml` tìm kiếm sâu tới 3 cấp thư mục con (ví dụ `html/main/index.html`).
3. `src/lib/local-files/spck-app-screenshotter.ts`:
   - Tăng `maxBuffer: 64 * 1024 * 1024` và `timeout: 30000` cho tiến trình chụp giao diện HTML tĩnh (`QTextDocument` offline) để không bị lỗi `ENOBUFS` khi trang web có nhiều ảnh màu dung lượng lớn.
4. `src/app/api/spck/scan/route.ts` & `src/app/final-project/page.tsx`:
   - Chỉ trả `HTTP 400` khi `overLimitErrors.length > 0 && persistedCount === 0` (giữ tương thích `T12` trong `test-spck-v270.ts`); khi có học viên hợp lệ (`persistedCount > 0`) thì trả `success: true` kèm `warning` và `records` đầy đủ.
   - Lọc bỏ các ảnh nguyên liệu web cũ không thuộc `_spck_app_shots`/`_spck_youtube_frames`/`_spck_owner_uploads` hoặc `scannedScreenshots` khi quét lại cùng thư mục.
   - Tự động đồng bộ (`syncLatestSharedResourcesToSessionDraft`) cho các bản nháp buổi `12/13/14` đang ở trạng thái `DRAFT` nguyên bản (chưa có `teacherComment`/`teacherNote` và chưa `lastVerifiedAt`).
5. `src/components/final-project/useSpckWorkflow.ts`, `src/components/final-project/ToolsDrawer.tsx`, `src/components/final-project/Session14Panel.tsx`:
   - Nhận diện `_web_package.zip` tương đương `.html` trong `isWebClassOrProduct`, `isAppOrGameProduct`, `runAutoPrepAfterScan`.
   - Ẩn 2 nút chạy thủ công trùng lặp (*"Chụp Giao Diện Web/App"*, *"Chạy Thử Web"*) trên thanh Bước 2 khi `autoRunToolsAfterScan === true` và chuyển vào trong ngăn *"Công cụ Drive & Cổng thu bài (Tùy chọn)"*.
   - Lược bỏ dòng thống kê Thư 3 phần và nút *"🏅 Mở Tab 2"* bị lặp lại lần 2 trong `Session14Panel.tsx`.
6. Tài liệu: `PROJECT_STATE.md`, `CHANGELOG.md`, `MINDX_AUTOMATION_PLAN.md`, `AGENTS.md`.

## 2. RÀNG BUỘC AN TOÀN DỮ LIỆU & SANDBOX TUYỆT ĐỐI
1. **KHÔNG ĐƯỢC ĐỤNG VÀO DỮ LIỆU THẬT CỦA OWNER:**
   - Mọi lệnh chạy kiểm thử phải truyền biến môi trường cô lập về `$env:TEMP`:
     - `$env:ALLOWED_LOCAL_DIRS = $env:TEMP`
     - `$env:MINDX_DB_PATH = "$env:TEMP\mindx_codex_web_spck.db"`
     - `$env:MINDX_RUNNING_CLASSES_PATH = "$env:TEMP\mindx_codex_web_spck_rc.json"`
     - `$env:GEMINI_API_KEY = "test-web-spck-dummy-key"`
   - Vì `data/mindx_bot.db` có thể đang được mở bởi dev server (khiến PowerShell `Get-FileHash` báo file in use), hãy dùng lệnh Node.js chỉ đọc (`fs.readFileSync`) để đo và đối chiếu SHA-256 trước và sau kiểm định:
     - `data/mindx_bot.db`: `1483E2B9079B4A9D2E436AC4312907FED450F9A46F508930B1B785F332831802`
     - `data/running_classes.json`: `F03A852729D2D75470991BD4B8BAE2D86AB0EE0A68ABBF7801FB7417C125CBE9`
   - Tuyệt đối không ghi hay sửa dữ liệu trong `F:\MINDX_SPCK_FINAL\JSB16` (nếu cần kiểm thử trên cấu trúc tương tự, hãy tạo fixture tạm thời trong `$env:TEMP`).
2. **KHÔNG SỬA ĐỔI** mã nguồn ứng dụng (`src/**`), `scripts/**`, hoặc cấu hình dự án.
3. **LƯU Ý DỌN DẸP `$env:TEMP`:** Khi xóa thư mục tạm trong `$env:TEMP`, dùng `node -e "require('node:fs').rmSync(process.env.AUDIT_TEMP, { recursive: true, force: true })"` thay vì PowerShell `Remove-Item -Recurse -Force`.

## 3. CÁC CỔNG KIỂM THỬ & PROBE CẦN THỰC HIỆN
1. `npx tsc --noEmit --incremental false`
2. `npx tsx scripts/test-phase6.ts`
3. `npx tsx scripts/test-spck-v270.ts`
4. `npx tsx scripts/test-spck-v272.ts`
5. `npx tsx scripts/test-streamline-v340-s5.ts`
6. Viết và chạy một **Adversarial Probe độc lập** trong `$env:TEMP` kiểm tra các góc khuất:
   - Dự án Web có $> 20$ ảnh nguyên liệu trong `images/` và $> 12$ file `.html`/`.css`/`.js` trong thư mục con (`HTML/main/index.html`, `CSS/style.css`), kèm 1 file `.html` rỗng (`0 byte` hoặc chỉ có khoảng trắng): xác nhận `scanStudentSpckFolder` loại bỏ ảnh nguyên liệu khỏi `screenshots`, bỏ qua file rỗng, đóng gói `<safeSlug>_web_package.zip` hợp lệ (`validateSpckAttachmentFile` đạt `valid: true`), và khi quét lại lần 2 không đóng gói lồng `*_web_package.zip`.
   - `findStudentWebRootAndEntryHtml` và `collectStudentWebFiles` với `html/main/index.html` sâu 2–3 cấp và có thư mục `_spck_app_shots`: xác nhận tìm đúng `entryHtmlRelativePath` và không đẩy `_spck_app_shots` hay `*_web_package.zip` lên GitHub.
   - `/api/spck/scan`: khi 1 học viên bị lỗi vượt giới hạn (ví dụ $> 10$ ảnh Owner) nhưng các học viên khác hợp lệ (`persistedCount > 0`), API trả `HTTP 200` (`success: true`, có `warning` và `records` của các học viên hợp lệ); khi tất cả học viên đều lỗi (`persistedCount === 0`), API trả `HTTP 400` (`success: false`).
   - Bảo toàn bản nháp buổi đã có `teacherComment` (`WAITING_APPROVAL` / `APPROVED` / `VERIFIED`) khi quét lại (không tự ghi đè), trong khi bản nháp `DRAFT` nguyên bản chưa có nhận xét được đồng bộ tài nguyên mới ngay.

## 4. ĐẦU RA BÁO CÁO
Ghi báo cáo kiểm định độc lập đầy đủ (UTF-8 chuẩn tiếng Việt có dấu) vào `docs/audits/v340/CODEX_WEB_SPCK_AUDIT.md` gồm:
- **Decision / Verdict:** `GO` hoặc `NO-GO`.
- **Gate Execution Summary:** Bảng kết quả chạy các lệnh kiểm thử và probe độc lập.
- **Finding Table:** Các phát hiện (nếu có) phân loại theo mức độ `HIGH` / `MEDIUM` / `LOW`, kèm `file:line` và bằng chứng tái현.
- **Production Data Preservation Check:** SHA-256 trước và sau của `data/mindx_bot.db` và `data/running_classes.json`.
