# BÁO CÁO KIỂM ĐỊNH ĐỘC LẬP `Gemini 4 Neon (XHigh)` — MindX Bot `v3.8.1`

- **Ngày kiểm định:** `2026-11-21`
- **Phiên bản:** `v3.8.1` (Sửa đăng nhập Admin LMS `tuanpa@mindx.com.vn`, mở rộng nhận diện `.mindx.com.vn` + JWT cookie `session` + tự đăng nhập lại phiên Giáo viên `quangda@mindx.net.vn`, lọc đúng cơ sở `205ALHP` Vũng Tàu `644346f794300678908f79bc` với khám phá 4 tầng & fallback `class(id)`, cùng gói gia cố toàn diện từ `Neon XHigh`)
- **Auditor độc lập:** `Gemini 4 Neon (XHigh)` (`neon-xhigh-auditor`)
- **Kết luận cuối cùng (Round 2):** **`VERDICT: GO`** (`9/9` phát hiện Round 1 `F01`–`F09` ĐÃ ĐÓNG, `0` lỗi P0/P1/P2/P3 mở)

---

## 1. Tiến trình Kiểm định qua 2 Vòng

1. **Round 1 (`NO-GO` — `5× P1`, `3× P2`, `1× P3` — `3/5` `probe_config.ts` & `7/17` `probe_auth_and_scanner.ts`; `7/7` Live Read-Only UI PASS):**
   - `F01` (P1 — `src/lib/admin-center/admin-lms-scanner.ts`): Tier 1 thất bại phân trang nửa chừng + Tier 2 `classesMissAttendOrComment` trả về `[]` sạch vẫn kích `complete = true` trên dữ liệu Tier 1 dở dang và chạy `clearCenterClassesNotIn(...)` xóa nhầm lớp cũ. Đã khóa bằng `tier2RawCount`, `tier3RawCount`, `tier1ExpectedRunningTotal`, siết kiểm `pagination.total` Tier 1, và đặt `finOk = false` khi `FINISHED` payload sai định dạng.
   - `F02` (P1 — `src/lib/admin-center/admin-lms-scanner.ts`): `isFinishedClassWithinGraceWindow` đọc bảng Giáo viên `classes_sessions` và regex `\b` hỏng với ngày ISO-8601 `...T...Z` và epoch ms. Đã thay bằng `normalizeAdminDateToIsoYmd` và `isAdminFinishedClassWithinGraceWindow` độc lập bảng Giáo viên (hỗ trợ `YYYY-MM-DD`, ISO-8601, `DD/MM/YYYY`, epoch s/ms dạng số và chuỗi) trên cả bộ lọc discovery, post-detail, `checkActiveAfterDetail` và `computeAdminClassAudits`.
   - `F03` (P1 — `src/lib/playwright/auth.ts`): `matchesExpectedLmsIdentity` cắt bỏ tên miền cả khi 2 bên đều có `@`, làm nhầm `tuanpa@mindx.net.vn` với `tuanpa@mindx.com.vn`. Đã siết `if (det.includes("@") && exp.includes("@")) return det === exp;` (vẫn giữ khớp local-part cho đăng nhập bare username).
   - `F04` (P1 — `src/lib/config.ts`): `ADMIN_LMS_USERNAME !== undefined` bị `@next/env` kích hoạt sẵn khi khởi động Next.js làm tắt nạp nóng `.env.local` theo `mtimeMs`; xóa/comment khóa trong `.env.local` không xóa giá trị cũ trong `process.env`. Đã thay bằng `detectPreseededAdminTestEnv()` (phân biệt `@next/env` với override/test env kể cả mật khẩu có ký tự `$`), tự xóa/reset khóa vắng mặt khi hot-reload và bỏ fallback về `config.adminLms*` cũ sau hot-reload.
   - `F05` (P1 — `src/lib/admin-center/admin-lms-scanner.ts`, `src/lib/admin-center/admin-teaching-actions.ts`): `fetchSingleLmsClassGqlInAdminSession` gọi `openClassDrawer` / `switchDrawerTab` không bọc `try/catch` và không nhận `lmsClassId` đã biết, gây lỗi thực tế cho đồng bộ BTVN từng lớp (`VT-C4K-GI36`, `VT-C4K-PTA15`, `VT-C4K-SI26`). Đã truyền `{ lmsClassId: existing?.lmsClassId }`, bọc `try/catch` quanh mở Drawer để đi thẳng xuống cookie-JWT GraphQL và dự phòng `fallbackKnownId`.
   - `F06` (P2 — `src/lib/admin-center/admin-lms-scanner.ts`): `fetched.skippedHistoricalFinished` chạy trước `assertMatchingLmsClassPayload`, bỏ lọt payload lớp `FINISHED` trả nhầm mã lớp. Đã đảo `assertMatchingLmsClassPayload` lên trước `skippedHistoricalFinished`.
   - `F07` (P2 — `src/lib/playwright/auth.ts`): `captureMindxRoleSnapshot` đọc `localStorage` của trang ngoại lai (như `drive.google.com`) khi chụp snapshot `TEACHER`. Đã khóa chỉ đọc `readLmsStorageDump` khi `hostname === lmsHost`, còn tab khác trả `{}` và lấy danh tính từ MindX cookies.
   - `F08` (P2 — `src/lib/config.ts`, `src/lib/admin-center/admin-lms-scanner.ts`): `ADMIN_LMS_CENTRE_IDS=NONE` / `"-"` bị `captureState.capturedCentres` ghi đè thành lọc `centre_in`. Đã bổ sung cờ `adminLmsCentreFilterDisabled` để chặn hẳn `capturedCentres`.
   - `F09` (P3 — `src/lib/admin-center/admin-lms-scanner.ts`, `src/lib/playwright/auth.ts`): (a) ghi đè `clsLastErr` khi `class(id)` gặp lỗi HTTP `401/403/500`; (b) neo regex `/(^|\.)mindx\.(edu|net|com)\.vn$/i` trong `clearCookies`; (c) truyền `{ [c.name]: decoded }` và sắp xếp `PREFERRED_LMS_AUTH_COOKIE_NAMES` trong `extractIdentityFromMindxCookies` + chặn `!Array.isArray(parsed)` ở `tryDecodeJwtPayload`; (d) chấp nhận `errors: []` ở `listRes` và thoát vòng lặp sớm khi gặp `isTransportOrAuthErr`.
2. **Round 2 (`VERDICT: GO` — đóng trọn `9/9` `F01`–`F09`, `0` phát hiện mới):**
   - Bộ probe độc lập Round 2 (`probe_r2_config.ts` `6/6`, `probe_r2_auth_scanner.ts` `14/14`, `probe_r2_live_ui.ts` `7/7`) đạt **`27/27 PASS, 0 FAIL`** trên `$env:TEMP` (`LEFTOVER_TEMP=0`).

---

## 2. Cổng Kiểm thử, Nghiệm thu Thực tế & Toàn vẹn Dữ liệu

- **TypeScript:** `node .\node_modules\typescript\bin\tsc --noEmit --incremental false` → **PASS (`exit 0`)**
- **Bộ kiểm thử tự động & hồi quy:** `npx.cmd tsx scripts/test-admin-center-v350.ts` (`[AC-01]..[AC-13]`) → **PASS (`exit 0`)**
- **Kiểm định đọc trực tiếp giao diện & API (`http://127.0.0.1:3000/admin-center` — Chromium cô lập tạm thời):** `7/7 PASS` (`GET /api/admin-center/overview` HTTP `200`, `46` lớp, `tu***@mindx.com.vn`, `GET /api/config` HTTP `200`, `MindX Bot v3.8.1`, 8 liên kết `TopNavbar` giữ 1 dòng ở `1280×800` & `1440×900` Light/Dark, đủ 5 tab, `0` lỗi console/page/HTTP, `0` idle polling trong `3.2s`, `0` rò rỉ bí mật).
- **Nghiệm thu Quét thực tế Cơ sở `205ALHP` (`POST /api/admin-center/scan` `ALL`):** `COMPLETED` **`46/46` lớp** (`27` Coding, `19` Robotics, `0` lỗi), khôi phục sạch phiên Giáo viên `quangda@mindx.net.vn`.
- **Đồ thị AST Graphify (`--code-only`):** `2.512` nodes, `9.142` edges, `87` communities (`graphify-out/graph.json`).
- **Vệ sinh TEMP:** `LEFTOVER_TEMP=0`; `0` tệp nguồn bị auditor chỉnh sửa.
- **Bảo toàn `100%` SHA-256 trên cả `4/4` tệp dữ liệu thật (khớp trước và sau Round 2):**
  - `data/mindx_bot.db`: `1B7C1A0FA787663944B2FE97B9F656DDC3C4DA2FC7492427B8684CCF6C6E6B64`
  - `data/mindx_bot.db-wal`: `1530C893FBA7C0B8F7F80A2C2CF794C97A5669EA48916390CD6E14781C1A5986`
  - `data/running_classes.json`: `226C2412CCF917CCC803B7D94019DDE253B08F9B31A86BDCE91E3A4EF2CC2EA1`
  - `data/config/lms_class_ids.json`: `AC93C6A821E9D6FA8B148E82EC1D56B5FFEB627EE300935DE97AE3A62F7FA188`
