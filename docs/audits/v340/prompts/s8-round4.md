# NHIỆM VỤ KIỂM ĐỊNH ĐỘC LẬP — CHẶNG S8 ROUND 4 (FINAL ACCEPTANCE CLOSURE AUDIT `v3.4.0`)

Bạn là **Independent Auditor (`gpt-6.1-sol` `high`)** kiểm định việc đóng **2 phát hiện `MEDIUM` duy nhất còn mở từ Vòng 3 (`S8-R3-01` và `S8-R3-02`)** trong báo cáo `docs/audits/v340/CODEX_V340_FINAL_ROUND3.md` để chốt cổng nghiệm thu cuối cùng (**Stage S8**) cho phiên bản `v3.4.0`.

## 1. BỐI CẢNH & BẢN SỬA ROUND 4
Tại Vòng 3 (`docs/audits/v340/CODEX_V340_FINAL_ROUND3.md`), bạn đã xác nhận:
- **`S8-01`: CLOSED** (`path-probe.cjs` trả `403`, `policyPass: true`, `edge-probe.cjs` đạt `20/20 PASS`).
- **`S8-02`: CLOSED** (`browser-policy-probe.cjs` đạt `0` context phụ, `strictSinglePersistentContextPolicyPass: true`; `/api/spck/capture-screenshots` xếp hàng qua `SequentialTaskQueue` và tôn trọng `ensureCaptureNotStopped()`).
- **`S8-R2-01`: CLOSED** (`renderer-resource-probe.cjs` đạt `5/5 policyPass`, toàn bộ `7/7` ca junction trỏ sang vùng cấm đều đạt `redPixels === 0`).
- Chỉ còn **2 phát hiện `MEDIUM` (`S8-R3-01` và `S8-R3-02`)** làm mất ảnh nền hợp lệ trong `style="background-image:url(...)"` và `<link rel=stylesheet href=css/site.css>`.

### Bản sửa Round 4 (chỉ sửa duy nhất 10 dòng trong `src/lib/local-files/spck-app-screenshotter.ts` so với Round 3):
1. **Đóng `S8-R3-01`:** `rewriteCssUrls` sinh `url(${memUri})` không bao dấu nháy kép, nên giữ nguyên cú pháp hợp lệ trong cả `style="background-image:url(...)"`, `style='background-image:url(...)'` và `<style>...</style>`.
2. **Đóng `S8-R3-02`:** Tạo tiền tố ngẫu nhiên mỗi lượt dựng `const memNamespace = \`mem://asset_${crypto.randomBytes(6).toString("hex")}_\`;`. Trong `registerApprovedImageRef`, nếu tham chiếu đã bắt đầu bằng đúng `memNamespace` của lượt dựng hiện tại và tồn tại trong `approvedResources`, trả về nguyên vẹn `trimmed` để bước `rewriteCssUrls` toàn trang không xóa mất `url(mem://...)` đã được duyệt khi inline `<link rel=stylesheet>` (đồng thời bài học viên không thể đoán trước `memNamespace` ngẫu nhiên).

## 2. RÀNG BUỘC AN TOÀN DỮ LIỆU TUYỆT ĐỐI
1. **KHÔNG ĐƯỢC ĐỤNG VÀO DỮ LIỆU THẬT CỦA OWNER:**
   - Mọi lệnh chạy kiểm thử phải truyền biến môi trường cô lập về `$env:TEMP`:
     - `$env:ALLOWED_LOCAL_DIRS = $env:TEMP`
     - `$env:MINDX_DB_PATH = "$env:TEMP\mindx_codex_s8_r4.db"`
     - `$env:MINDX_RUNNING_CLASSES_PATH = "$env:TEMP\mindx_codex_s8_r4_rc.json"`
     - `$env:GEMINI_API_KEY = "test-s8-dummy-key"`
   - Ngoại lệ duy nhất: Đo `Get-FileHash -Algorithm SHA256` chỉ đọc (read-only) trên `data/mindx_bot.db` (`A911EB02CD6E2610340604DCF42D53AFB428C50C02727C4CE44F138DEC9C8F16`) và `data/running_classes.json` (`ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2`) trước và sau kiểm định.
2. **KHÔNG SỬA ĐỔI** `src/**`, `scripts/**`, `AGENTS.md`, `GEMINI.md`, `next-env.d.ts`, hoặc các hồ sơ audit cũ.
3. **KHÔNG GỌI DỊCH VỤ THẬT** (MindX LMS, `teachingmindx.top`, Gemini API thật).

## 3. CÁC BƯỚC KIỂM ĐỊNH CẦN THỰC HIỆN
1. **Xác minh đóng `S8-R3-01` và `S8-R3-02`:**
   - Chạy lại `docs/audits/v340/s8-round3/renderer-compatibility-probe.cjs` (với `AUDIT_COMPAT_OUT`) $\rightarrow$ xác nhận đạt **14/14 PASS** (`7/7` hiển thị ảnh hợp lệ `redPixels > 1000` và `7/7` chặn junction `redPixels === 0`).
   - Chạy lại `docs/audits/v340/s8-round3/renderer-payload-probe.cjs` (nếu cần) và `docs/audits/v340/s8-round2/renderer-resource-probe.cjs` (`5/5 PASS`).
2. **Chạy lại các probe chính sách và bộ kiểm thử liên quan:**
   - `docs/audits/v340/s8-final/path-probe.cjs`
   - `docs/audits/v340/s8-final/browser-policy-probe.cjs`
   - `docs/audits/v340/s8-round2/edge-probe.cjs`
   - `npx tsc --noEmit --incremental false`
   - `npx tsx scripts/test-spck-v272.ts`
   - `npx tsx scripts/test-streamline-v340-s5.ts`
   - `npx tsx scripts/test-streamline-v340-s7.ts`
3. **Đo lại SHA-256 của 2 tệp dữ liệu thật** (`data/mindx_bot.db` và `data/running_classes.json`) và xác nhận bảo toàn 100%.

## 4. ĐẦU RA BÁO CÁO (LƯU Ý GHI UTF-8 CHUẨN TIẾNG VIỆT CÓ DẤU)
1. Ghi báo cáo chi tiết vào `docs/audits/v340/CODEX_V340_FINAL_ROUND4.md` (nêu rõ `VERDICT: GO`, trạng thái `S8-01: CLOSED`, `S8-02: CLOSED`, `S8-R2-01: CLOSED`, `S8-R3-01: CLOSED`, `S8-R3-02: CLOSED`, bảng kết quả lệnh kiểm chứng, và bảo toàn SHA-256).
2. Cập nhật phần đầu `docs/audits/v340/CODEX_V340_FINAL.md` bằng UTF-8 chuẩn để phản ánh kết quả **S8 Round 4 (`GO` — toàn bộ `5/5` mục đã `CLOSED`)** (đồng thời sửa lại dòng đầu của lịch sử Round 3 bị lỗi dấu `?` sang tiếng Việt có dấu chuẩn).
3. Cập nhật khối trạng thái đầu file của `PROJECT_STATE.md`, `CHANGELOG.md` và `MINDX_AUTOMATION_PLAN.md` bằng UTF-8 chuẩn đồng bộ với kết quả S8 Round 4.
