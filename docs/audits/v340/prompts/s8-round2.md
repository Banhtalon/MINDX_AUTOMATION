# NHIỆM VỤ KIỂM ĐỊNH ĐỘC LẬP — CHẶNG S8 ROUND 2 (FINAL ACCEPTANCE CLOSURE AUDIT `v3.4.0`)

Bạn là **Independent Auditor (`gpt-6.1-sol` `high`)** kiểm định việc đóng **2 phát hiện `MEDIUM` duy nhất còn mở từ Vòng 1 (`S8-01` và `S8-02`)** trong báo cáo `docs/audits/v340/CODEX_V340_FINAL.md` để chốt cổng nghiệm thu cuối cùng (**Stage S8**) cho phiên bản `v3.4.0`.

## 1. BỐI CẢNH & PHẠM VI TÁI KIỂM (S8 ROUND 2)
Tại Vòng 1 (`docs/audits/v340/CODEX_V340_FINAL.md`), bạn đã xác nhận:
- Đủ **9/9 báo cáo đóng chặng `S0` $\rightarrow$ `S7` đạt `GO`**.
- Chạy mới `npx tsc --noEmit --incremental false`, toàn bộ 8 bộ `test-streamline-v340-s1..s7`, `docs/audits/v340/s7-round1/adversarial-probe.cjs` (`116/116 PASS`, `20/20 payload`), và `npx next build --webpack` đều đạt **PASS (`exit code 0`)**.
- Chỉ còn **2 phát hiện `MEDIUM` có sẵn từ `S0`** cần đóng:
  1. **`S8-01` (`src/app/api/spck/browse-folder/route.ts`):** Nhánh `action: "list"` đọc và trả về danh sách thư mục con ngoài `Path Allowlist` mà không qua `assertPathAllowed` / `isPathAllowed`.
  2. **`S8-02` (`src/lib/local-files/spck-image-normalizer.ts`, `src/lib/local-files/spck-app-screenshotter.ts`, `src/app/api/spck/capture-screenshots/route.ts`):** Khởi tạo `chromium.launch` + `browser.newContext` độc lập ngoài `BrowserManager` (`./playwright-auth`) và chưa xếp hàng nhánh chụp ảnh hàng loạt của `/api/spck/capture-screenshots` qua `SequentialTaskQueue`.

### Bản sửa đã thực hiện cho Round 2 (chỉ trong 4 tệp nguồn, KHÔNG sửa `AGENTS.md` hay `GEMINI.md`):
1. **`S8-01` (`src/app/api/spck/browse-folder/route.ts`):**
   - Khi `action === "list"` có truyền `path` hoặc `initialDir`, bắt buộc kiểm tra qua `assertPathAllowed(...)` + `fs.realpathSync(...)` + `assertPathAllowed(realPath)`. Nếu nằm ngoài Allowlist $\rightarrow$ trả `HTTP 403` ngay lập tức (không liệt kê tên thư mục con và không tự đăng ký vào `teacher_browsed_dirs.json`).
   - Khi không truyền `path`/`initialDir`, chỉ chọn thư mục khởi đầu từ các thư mục đã nằm trong Allowlist (`isPathAllowed` + `realpathSync`).
   - Trong `listSubdirectories(dirPath)`: kiểm tra `assertPathAllowed(dirPath)` và lọc từng thư mục con qua `isPathAllowed(fullChild)` + `isPathAllowed(fs.realpathSync(fullChild))` (chặn cả junction/symlink trỏ ra ngoài Allowlist).
   - Chỉ trả `parentPath`, `drives` và `quickLinks` khi các đường dẫn đó thỏa `isPathAllowed`.
2. **`S8-02` (`src/lib/local-files/spck-image-normalizer.ts`, `src/lib/local-files/spck-app-screenshotter.ts`, `src/app/api/spck/capture-screenshots/route.ts`):**
   - Trong `src/lib/local-files/spck-image-normalizer.ts`: Gỡ bỏ hoàn toàn `import { chromium } from "playwright"`, `chromium.launch` và `browser.newContext`. Thay bằng bộ giải mã/nội suy/mã hóa PNG thuần Node.js (`node:zlib`) trong bộ nhớ kết hợp fallback `PyQt6.QtGui.QImage` (`QT_QPA_PLATFORM=offscreen`) cho JPEG/WEBP/GIF.
   - Trong `src/lib/local-files/spck-app-screenshotter.ts`: Gỡ bỏ hoàn toàn `import { chromium } from "playwright"`, `chromium.launch` và `browser.newContext` trong `captureHtmlWebScreenshots`. Thay bằng bộ dựng HTML tĩnh offline qua `PyQt6` (`QTextDocument` + `QImage` + `QPainter` ở khung `960×540`, `QT_QPA_PLATFORM=offscreen`) kết hợp kiểm tra tài nguyên nội bộ qua `resolveSafeStaticFile`. Đồng thời bổ sung `ensureCaptureNotStopped()` ở đầu hàm và đầu vòng lặp của `captureClassAppScreenshotsAndSelectThumbnails` (ném lại lỗi `TASK_CANCELLED` ngay khi bấm Stop).
   - Trong `src/app/api/spck/capture-screenshots/route.ts`: Đưa nhánh chụp ảnh hàng loạt (`captureClassAppScreenshotsAndSelectThumbnails`) vào `SequentialTaskQueue.getInstance().enqueue({ jobType: "UPLOAD_SPCK", ... })`.
   - Kết quả: Toàn bộ `src/**` chỉ còn duy nhất **1 nơi khởi tạo Playwright context** tại `src/lib/playwright/browser-manager.ts` (`chromium.launchPersistentContext`), tuân thủ tuyệt đối Quy tắc 3 mà không sửa `AGENTS.md`/`GEMINI.md` và không nạp HTML của học viên vào `./playwright-auth`.

## 2. RÀNG BUỘC AN TOÀN DỮ LIỆU TUYỆT ĐỐI
1. **KHÔNG ĐƯỢC ĐỤNG VÀO DỮ LIỆU THẬT CỦA OWNER:**
   - Mọi lệnh chạy kiểm thử phải truyền biến môi trường cô lập về `$env:TEMP`:
     - `$env:ALLOWED_LOCAL_DIRS = $env:TEMP`
     - `$env:MINDX_DB_PATH = "$env:TEMP\mindx_codex_s8_r2.db"`
     - `$env:MINDX_RUNNING_CLASSES_PATH = "$env:TEMP\mindx_codex_s8_r2_rc.json"`
     - `$env:GEMINI_API_KEY = "test-s8-dummy-key"`
   - Ngoại lệ duy nhất: Đo `Get-FileHash -Algorithm SHA256` chỉ đọc (read-only) trên `data/mindx_bot.db` (`A911EB02CD6E2610340604DCF42D53AFB428C50C02727C4CE44F138DEC9C8F16`) và `data/running_classes.json` (`ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2`) trước và sau kiểm định.
2. **KHÔNG SỬA ĐỔI** `src/**`, `scripts/**`, `AGENTS.md`, `GEMINI.md`, `next-env.d.ts`, hoặc `docs/audits/round-12..41`.
3. **KHÔNG GỌI DỊCH VỤ THẬT** (MindX LMS, `teachingmindx.top`, Gemini API thật).

## 3. CÁC BƯỚC KIỂM ĐỊNH CẦN THỰC HIỆN
1. **Xác minh đóng `S8-01`:**
   - Chạy lại `docs/audits/v340/s8-final/path-probe.cjs` (với `AUDIT_PATH_OUT`) và kiểm tra bổ sung các ca biên của `/api/spck/browse-folder` (`action: "list"` với đường dẫn ngoài Allowlist $\rightarrow$ `403`, thư mục con/junction trỏ ra ngoài Allowlist bị lọc bỏ, đường dẫn hợp lệ trong Allowlist trả `200`).
2. **Xác minh đóng `S8-02`:**
   - Chạy lại `docs/audits/v340/s8-final/browser-policy-probe.cjs` (với `AUDIT_BROWSER_OUT`) $\rightarrow$ xác nhận `standaloneLaunches === 0`, `newContexts === 0`, `strictSinglePersistentContextPolicyPass === true`.
   - Quét tĩnh toàn bộ `src/**` cho `chromium.launch`, `launchPersistentContext`, `newContext` $\rightarrow$ xác nhận chỉ có duy nhất `src/lib/playwright/browser-manager.ts` (`launchPersistentContext`).
   - Kiểm tra `/api/spck/capture-screenshots` xếp hàng qua `SequentialTaskQueue` và `captureClassAppScreenshotsAndSelectThumbnails` tôn trọng `ensureCaptureNotStopped()`.
3. **Chạy các lệnh kiểm tra kiểu dữ liệu & hồi quy liên quan trực tiếp (với biến môi trường `TEMP`):**
   - `npx tsc --noEmit --incremental false`
   - `npx tsx scripts/test-spck-v272.ts` (kiểm thử toàn diện chuẩn hóa ảnh `960×540`, chụp giao diện HTML `960×540`, YouTube frames & bảo mật đường dẫn)
   - `npx tsx scripts/test-streamline-v340-s5.ts`
   - `npx tsx scripts/test-streamline-v340-s7.ts`
   *(Không cần chạy lại toàn bộ 8 cổng khác hay `next build --webpack` nếu các tệp ngoài 4 tệp sửa Round 2 không thay đổi so với Round 1; có thể đối chiếu hash nguồn so với `docs/audits/v340/s8-final/protected-before.json`).*
4. **Đo lại SHA-256 của 2 tệp dữ liệu thật** (`data/mindx_bot.db` và `data/running_classes.json`) và xác nhận bảo toàn 100%.

## 4. ĐẦU RA BÁO CÁO
1. Ghi báo cáo chi tiết vào `docs/audits/v340/CODEX_V340_FINAL_ROUND2.md` (nêu rõ `VERDICT: GO` hoặc `NO-GO`, trạng thái `S8-01: CLOSED`, `S8-02: CLOSED`, bảng kết quả lệnh kiểm chứng, và bảo toàn SHA-256).
2. Cập nhật phần đầu `docs/audits/v340/CODEX_V340_FINAL.md` để phản ánh kết quả **S8 Round 2 (`GO` — `2/2 CLOSED`)** trong khi giữ nguyên nội dung lịch sử Round 1 bên dưới.
3. Cập nhật khối trạng thái đầu file của `PROJECT_STATE.md`, `CHANGELOG.md` và `MINDX_AUTOMATION_PLAN.md` đồng bộ với kết quả S8 Round 2.
