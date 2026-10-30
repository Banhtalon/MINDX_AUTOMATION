# NHIỆM VỤ KIỂM ĐỊNH ĐỘC LẬP — CHẶNG S8 ROUND 3 (FINAL ACCEPTANCE CLOSURE AUDIT `v3.4.0`)

Bạn là **Independent Auditor (`gpt-6.1-sol` `high`)** kiểm định việc đóng phát hiện duy nhất còn mở từ Vòng 2 (**`S8-R2-01`**) trong báo cáo `docs/audits/v340/CODEX_V340_FINAL_ROUND2.md` để chốt cổng nghiệm thu cuối cùng (**Stage S8**) cho phiên bản `v3.4.0`.

## 1. BỐI CẢNH & BẢN SỬA ROUND 3
Tại Vòng 2 (`docs/audits/v340/CODEX_V340_FINAL_ROUND2.md`), bạn đã xác nhận:
- **`S8-01`: CLOSED** (`path-probe.cjs` trả `403`, `policyPass: true`, `edge-probe.cjs` đạt `20/20 PASS`).
- **`S8-02`: CLOSED** (`browser-policy-probe.cjs` đạt `standaloneLaunches === 0`, `newContexts === 0`, `strictSinglePersistentContextPolicyPass === true`; chỉ còn duy nhất 1 nơi tạo context tại `src/lib/playwright/browser-manager.ts:139`; `/api/spck/capture-screenshots` đã xếp hàng qua `SequentialTaskQueue` và tôn trọng `ensureCaptureNotStopped()`).
- Chỉ còn **1 phát hiện `S8-R2-01` (`HIGH OPEN`)**: `QTextDocument` mặc định tự mở tài nguyên `file:///...` trong `<img src=unquoted>`, `<body background="...">`, `style="background-image:url(...)"` mà không qua `resolveSafeStaticFile`.

### Bản sửa Round 3 (chỉ sửa duy nhất 1 tệp `src/lib/local-files/spck-app-screenshotter.ts` so với Round 2):
1. **Chặn cứng tại tầng `QTextDocument.loadResource` trong Python (`SafeTextDocument`):**
   - Kế thừa `QTextDocument` thành `SafeTextDocument` và ghi đè `def loadResource(self, res_type, url):` **tuyệt đối không gọi `super().loadResource(res_type, url)`**.
   - Chỉ nhận các ảnh đã được TypeScript kiểm duyệt qua `resolveSafeStaticFile(safeRoot, joinedPosix)` (`assertPathAllowed` + `fs.realpathSync`), truyền dưới dạng byte base64 trong bộ nhớ (`resources["mem://asset_N"]`) và giải mã bằng `QImage.fromData(raw_bytes)`.
   - Mọi URL khác (`file://`, đường dẫn tương đối/tuyệt đối, UNC, mạng, hoặc thuộc tính HTML/CSS bất kỳ chưa được duyệt sang `mem://asset_N`) đều trả về `None` ngay tại `loadResource`.
2. **Tiền xử lý tài nguyên HTML/CSS trong TypeScript (`captureHtmlWebScreenshots`):**
   - `resolveLocalAsset(rawHref, baseDirPosix)` chặn mọi URI có scheme (`file:`, `http:`, `https:`, `ftp:`, `qrc:`, v.v.), UNC (`//`, `\\`) và ký tự ổ đĩa Windows, giải mã `decodeURIComponent`, chuẩn hóa đường dẫn tương đối (kể cả tương đối từ thư mục chứa file CSS khi inline `<link rel=stylesheet>`) và kiểm tra qua `resolveSafeStaticFile(safeRoot, joinedPosix)`.
   - Viết lại cả thuộc tính có dấu nháy và không dấu nháy cho `<link rel=stylesheet href=...>`, `url(...)` trong `<style>`/inline `style`, `src=...` và `background=...` sang `mem://asset_N` (hoặc xóa về `""` / `none` nếu bị từ chối).

## 2. RÀNG BUỘC AN TOÀN DỮ LIỆU TUYỆT ĐỐI
1. **KHÔNG ĐƯỢC ĐỤNG VÀO DỮ LIỆU THẬT CỦA OWNER:**
   - Mọi lệnh chạy kiểm thử phải truyền biến môi trường cô lập về `$env:TEMP`:
     - `$env:ALLOWED_LOCAL_DIRS = $env:TEMP`
     - `$env:MINDX_DB_PATH = "$env:TEMP\mindx_codex_s8_r3.db"`
     - `$env:MINDX_RUNNING_CLASSES_PATH = "$env:TEMP\mindx_codex_s8_r3_rc.json"`
     - `$env:GEMINI_API_KEY = "test-s8-dummy-key"`
   - Ngoại lệ duy nhất: Đo `Get-FileHash -Algorithm SHA256` chỉ đọc (read-only) trên `data/mindx_bot.db` (`A911EB02CD6E2610340604DCF42D53AFB428C50C02727C4CE44F138DEC9C8F16`) và `data/running_classes.json` (`ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2`) trước và sau kiểm định.
2. **KHÔNG SỬA ĐỔI** `src/**`, `scripts/**`, `AGENTS.md`, `GEMINI.md`, `next-env.d.ts`, hoặc các hồ sơ audit cũ.
3. **KHÔNG GỌI DỊCH VỤ THẬT** (MindX LMS, `teachingmindx.top`, Gemini API thật).

## 3. CÁC BƯỚC KIỂM ĐỊNH CẦN THỰC HIỆN
1. **Xác minh đóng `S8-R2-01`:**
   - Chạy lại `docs/audits/v340/s8-round2/renderer-resource-probe.cjs` $\rightarrow$ xác nhận cả 5/5 ca đạt `policyPass: true` (`redPixels === 0` cho mọi ảnh ngoài phạm vi cho phép).
   - Kiểm tra bổ sung: ảnh hợp lệ bên trong thư mục lớp (`allowed/`) hiển thị bình thường qua `<img src="...">`, `<img src=unquoted>`, `<body background=...>`, `style="background-image:url(...)"` và `<link rel=stylesheet>`, trong khi junction bên trong `allowed/` trỏ sang `denied/` bị chặn hoàn toàn (`redPixels === 0`).
2. **Chạy lại hai probe chính sách và bộ kiểm thử theo điều kiện đóng của Round 2:**
   - `docs/audits/v340/s8-final/path-probe.cjs`
   - `docs/audits/v340/s8-final/browser-policy-probe.cjs`
   - `docs/audits/v340/s8-round2/edge-probe.cjs`
   - `npx tsc --noEmit --incremental false`
   - `npx tsx scripts/test-spck-v272.ts`
   - `npx tsx scripts/test-streamline-v340-s5.ts`
   - `npx tsx scripts/test-streamline-v340-s7.ts`
3. **Đo lại SHA-256 của 2 tệp dữ liệu thật** (`data/mindx_bot.db` và `data/running_classes.json`) và xác nhận bảo toàn 100%.

## 4. ĐẦU RA BÁO CÁO
1. Ghi báo cáo chi tiết vào `docs/audits/v340/CODEX_V340_FINAL_ROUND3.md` (nêu rõ `VERDICT: GO`, trạng thái `S8-01: CLOSED`, `S8-02: CLOSED`, `S8-R2-01: CLOSED`, bảng kết quả lệnh kiểm chứng, và bảo toàn SHA-256).
2. Cập nhật phần đầu `docs/audits/v340/CODEX_V340_FINAL.md` để phản ánh kết quả **S8 Round 3 (`GO` — toàn bộ `3/3` mục `S8-01`, `S8-02`, `S8-R2-01` đã `CLOSED`)** trong khi giữ nguyên lịch sử bên dưới.
3. Cập nhật khối trạng thái đầu file của `PROJECT_STATE.md`, `CHANGELOG.md` và `MINDX_AUTOMATION_PLAN.md` đồng bộ với kết quả S8 Round 3.
