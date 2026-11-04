# NHIỆM VỤ KIỂM ĐỊNH ĐỘC LẬP — VÒNG 2 (ROUND 2 CLOSURE AUDIT): BẢN VÁ LỚP WEB SPCK & TINH GỌN MÀN 3 (`/final-project`)

Bạn là **Independent Quality & Safety Auditor (`gpt-6.1-sol` `high`)** kiểm định việc đóng toàn bộ **4 phát hiện (`F01`–`F04`)** từ báo cáo Vòng 1 (`docs/audits/v340/CODEX_WEB_SPCK_AUDIT.md`) cho đợt nâng cấp **Tự động xử lý giới hạn 10 ảnh / 10 file LMS cho lớp Web SPCK & Tinh gọn Màn 3 (`/final-project`)**.

## 1. BẢN SỬA ĐÃ ÁP DỤNG CHO `F01` – `F04`
1. **Đóng `F01` (`HIGH` — `src/lib/local-files/spck-scanner.ts`, `src/lib/file-parsers/archive-reader.ts`):**
   - Bổ sung `.htm`, `.mjs`, `.text`, `.md`, `.csv`, `.xml` vào `ALLOWED_ATTACHMENT_EXTENSIONS` và `TEXT_ATTACHMENT_EXTENSIONS` trong `spck-scanner.ts`, đồng thời bổ sung `.mjs`, `.text`, `.csv`, `.xml` vào `READABLE_CODE_EXTENSIONS` trong `archive-reader.ts`.
   - Trong `walkWebProject`, đánh dấu `hasSubfolderWebCode = true` cho toàn bộ các đuôi thuộc `WEB_SOURCE_BUNDLE_EXTS` khi `depth >= 1` (bao gồm cả `modules/app.mjs`).
   - Điều kiện đóng gói `<safeSlug>_web_package.zip` xét đồng thời `(validAttachments.length > MAX_SPCK_ATTACHMENTS || webSourceFiles.length > MAX_SPCK_ATTACHMENTS || hasSubfolderWebCode)`.
2. **Đóng `F02` (`HIGH` — `src/lib/local-files/spck-scanner.ts`):**
   - Nâng ngưỡng dung lượng tệp mã nguồn Web đơn lẻ đưa vào `webSourceFiles` từ `5 MB` lên `15 MB` (`15 * 1024 * 1024`, khớp với `ZIP_MAX_SINGLE_FILE_BYTES` của `archive-reader.ts`), đồng thời thêm cảnh báo rõ vào `warnings` nếu có tệp mã nguồn vượt quá `15 MB`.
   - Khi thay danh sách `validAttachments` sau khi tạo `<safeSlug>_web_package.zip`, chỉ loại bỏ đúng những tệp có đường dẫn thực tế nằm trong `bundledPathKeys` (`webSourceFiles`), giữ nguyên mọi tệp hợp lệ chưa được đóng gói vào ZIP (`unbundledAttachments`).
3. **Đóng `F03` (`MEDIUM` — `src/app/final-project/page.tsx`):**
   - Trong `handleScanFolder`, dựng `attachments`, `screenshots`, `youtubeUrlsText`, `relatedLinksText` ưu tiên từ `dbRec` (bản ghi theo buổi trả về từ `/api/spck/scan`), chỉ dùng `pkg.*` làm giá trị dự phòng khi chưa có `dbRec`. Nhờ đó bản nháp `DRAFT` nguyên bản nhận ngay tài nguyên mới qua bước đồng bộ ở route, còn bản đã chỉnh sửa / `WAITING_APPROVAL` / `APPROVED` / `VERIFIED` giữ nguyên bộ tệp đính kèm đã duyệt trên giao diện kèm cờ `hasNewerSharedResources: true`.
4. **Đóng `F04` (`LOW` — `src/lib/local-files/spck-scanner.ts`):**
   - Trong `validateSpckAttachmentFile`, kiểm tra mọi tệp thuộc `TEXT_ATTACHMENT_EXTENSIONS`: từ chối tệp chứa byte nhị phân `\x00` hoặc chỉ chứa khoảng trắng (`textContent.trim().length === 0`), thống nhất hoàn toàn giữa nhánh đính kèm rời và nhánh đóng gói ZIP.

## 2. RÀNG BUỘC AN TOÀN DỮ LIỆU & SANDBOX TUYỆT ĐỐI
1. **KHÔNG ĐƯỢC ĐỤNG VÀO DỮ LIỆU THẬT CỦA OWNER:**
   - Mọi lệnh chạy kiểm thử phải truyền biến môi trường cô lập về `$env:TEMP`:
     - `$env:ALLOWED_LOCAL_DIRS = $env:TEMP`
     - `$env:MINDX_DB_PATH = "$env:TEMP\mindx_codex_web_spck.db"`
     - `$env:MINDX_RUNNING_CLASSES_PATH = "$env:TEMP\mindx_codex_web_spck_rc.json"`
     - `$env:GEMINI_API_KEY = "test-web-spck-dummy-key"`
   - Đo và đối chiếu SHA-256 chỉ đọc bằng Node.js (`fs.readFileSync`) trước và sau kiểm định:
     - `data/mindx_bot.db`: `1483E2B9079B4A9D2E436AC4312907FED450F9A46F508930B1B785F332831802`
     - `data/running_classes.json`: `F03A852729D2D75470991BD4B8BAE2D86AB0EE0A68ABBF7801FB7417C125CBE9`
2. **KHÔNG SỬA ĐỔI** mã nguồn ứng dụng (`src/**`), `scripts/**`, hoặc cấu hình dự án.

## 3. CÁC BƯỚC KIỂM ĐỊNH VÒNG 2
1. Đồng bộ 3 tệp vừa sửa (`src/lib/file-parsers/archive-reader.ts`, `src/lib/local-files/spck-scanner.ts`, `src/app/final-project/page.tsx`) sang bản sao kiểm thử `%TEMP%\mindx-web-spck-audit-20261103-codex\snapshot` và đối chiếu SHA-256 `src/**` + `scripts/**` giữa bản gốc và bản sao.
2. Chạy mới đầy đủ 5 cổng kiểm thử và bộ 19 ca probe độc lập (`audit-probe.cts`):
   - `npx --no-install tsc --noEmit --incremental false`
   - `npx --no-install tsx scripts/test-phase6.ts`
   - `npx --no-install tsx scripts/test-spck-v270.ts`
   - `npx --no-install tsx scripts/test-spck-v272.ts`
   - `npx --no-install tsx scripts/test-streamline-v340-s5.ts`
   - `npx --no-install tsx audit-probe.cts` (xác nhận đạt **19/19 PASS**, bao gồm `P09`, `P10`, `P11`, `P12`, `P13`, `P14`).
3. Cập nhật báo cáo `docs/audits/v340/CODEX_WEB_SPCK_AUDIT.md` (UTF-8 chuẩn tiếng Việt có dấu) với kết quả **Round 2 (`VERDICT: GO`, `F01: CLOSED`, `F02: CLOSED`, `F03: CLOSED`, `F04: CLOSED`, `19/19 PASS`)**, đồng thời cập nhật dòng trạng thái đầu tệp của `PROJECT_STATE.md`, `CHANGELOG.md` và `MINDX_AUTOMATION_PLAN.md` sang **GO**.
