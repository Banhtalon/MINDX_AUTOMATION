# BÁO CÁO KIỂM ĐỊNH ĐỘC LẬP `v3.8.3` — GEMINI 4 NEON (XHIGH)

- **Ngày kiểm định:** `22/11/2026`
- **Mô hình Reviewer độc lập:** `Gemini 4 Neon (XHigh)` (`gemini-4-neon-xhigh`, worker `neon-auditor-v383` chạy cô lập trong `os.tmpdir()`)
- **Phạm vi kiểm định:**
  - `src/lib/playwright/spck-uploader.ts`: Dọn sạch tối đa `10/10` thẻ tệp đính kèm & ảnh sản phẩm cũ trên Modal LMS tái sử dụng theo từng khu vực an toàn (`F01` không rò sang Strategy C, `F02` lọc metadata + nút dropzone + dừng sớm khi DOM đứng yên, `F03` bắt tiêu đề linh hoạt kể cả khi ô tải tạm ẩn ở mốc 10 tệp & bỏ qua tên file của học viên, `F04` tách riêng khu vực ảnh sản phẩm khỏi avatar tiêu đề/thumbnail), chặn bấm đúp `"Xem chi tiết trang"`, và chụp ảnh + thống kê DOM khi quá giờ dropzone (`MINDX_DEBUG_SCREENSHOT_DIR`).
  - `src/lib/playwright/lms-helpers.ts`: Tự phục hồi 1 lần có giới hạn (`_retriedAfterLogin`) kèm dọn sạch listener (`cleanupListeners()`) khi phiên MindX LMS bất ngờ chuyển hướng về trang đăng nhập trong lúc tìm lớp / mở Drawer (`L1253` & `L1375`).
  - `src/lib/playwright/selectors.ts`: Sửa selector đăng nhập Teaching (`"Tên đăng nhập"`, `input[name="username"]:visible`, khóa phạm vi `form:has(input[type="password"]) input[type="text"]:visible` theo `F05`).
  - `scripts/test-spck-reupload-and-auth-v383.ts` (`[V383-01..V383-04]` + hồi quy `F01–F06`), `package.json`, `src/app/layout.tsx`, `src/components/top-navbar.tsx` (`v3.8.3`).

## 1. Kết quả các vòng kiểm định
- **Vòng 1 (`22/11/2026 15:20`):** `VERDICT: NO-GO` — phát hiện **`6/6` điểm (`1× P0`, `2× P1`, `2× P2`, `1× P3`)**:
  - `F01 [P0]`: Strategy C có thể chạy tiếp sau khi Strategy A/B xóa hết tệp đính kèm, dễ bấm nhầm nút xóa thẻ hoặc YouTube nếu có `.MuiTypography-caption`. -> **Đã đóng ở Vòng 2** (chặn tuyệt đối fallthrough khi `targetSections.length > 0` + gia cố Strategy C).
  - `F02 [P1]`: Nút tải xuống/xem trước dạng icon hoặc `+ Thêm files` kế bên có thể bị bấm lặp -> **Đã đóng ở Vòng 2** (kiểm tra metadata `text + aria-label + title + svg[...]`, ưu tiên nút xóa rõ nghĩa, dừng sớm khi DOM không đổi).
  - `F03 [P1]`: Tiêu đề `"Tài liệu đính kèm *"` khi ô tải ẩn ở 10/10 tệp và tên file chứa `"Sản phẩm học viên"` làm lệch nhận diện khu vực -> **Đã đóng ở Vòng 2**.
  - `F04 [P2]`: Quét ảnh theo vị trí `imgs[1..]` có thể xóa nhầm Thumbnail nếu `.MuiDialogTitle-root` có avatar -> **Đã đóng ở Vòng 2** (neo chặt vào khu vực `"Tải hình ảnh lên"`).
  - `F05 [P2]`: `form input[type="text"]` bắt nhầm ô tìm kiếm ở header hoặc input ẩn -> **Đã đóng ở Vòng 2** (`:visible` + `form:has(input[type="password"])`).
  - `F06 [P3]`: Bổ sung test trực tiếp nhánh `L1253`/`L1375` + `closeDb()` trước khi dọn thư mục tạm trên Windows -> **Đã đóng ở Vòng 2**.
- **Vòng 2 (`22/11/2026 15:37`):** **`VERDICT: GO`** — đóng trọn **`6/6`** phát hiện (`0` lỗi P0–P3 mở), **`17/17`** probe đối kháng Chromium độc lập PASS, `0` `__name(` trong toàn bộ callback `evaluate`.

## 2. Kết quả kiểm thử & đối chiếu SHA-256 dữ liệu thật
- `node .\node_modules\typescript\bin\tsc --noEmit --incremental false` -> **PASS (`exit 0`)**
- `npx.cmd tsx scripts/test-spck-reupload-and-auth-v383.ts` (`[V383-01..V383-04]` + `F01–F06`) -> **PASS (`exit 0`)**
- `npx.cmd tsx scripts/test-spck-streamlined-v355.ts` (`R355-01..R355-05`) -> **PASS (`exit 0`)**
- `npx.cmd tsx scripts/test-spck-v360.ts` (`V360-01..V360-05` + `Round-38`) -> **PASS (`exit 0`)**
- `npx.cmd tsx scripts/test-spck-reupload-v353.ts` (`R353-01..R353-04`) -> **PASS (`exit 0`)**
- `npx.cmd tsx scripts/test-csi-demo-limits-v382.ts` (`[CSI-01..CSI-04]`) -> **PASS (`exit 0`)**
- `$env:GRAPHIFY_BACKEND="none"; graphify update .` -> **PASS (`exit 0`, `2.528` nodes / `9.199` edges / `88` communities)**
- **Bảo toàn `100%` SHA-256 dữ liệu thật trước = sau kiểm định:**
  - `data/mindx_bot.db`: `4018E659F9D4C892C10A535ECBE9F38658A56FF009691E4897FA7A44C58BFFCD`
  - `data/running_classes.json`: `29DCF71A9CA34300D2401861D99634AB77CC0F280D54778D99E79D2B676D55F8`
  - `data/config/lms_class_ids.json`: `AC93C6A821E9D6FA8B148E82EC1D56B5FFEB627EE300935DE97AE3A62F7FA188`

## 3. Nghiệm thu thực tế lớp `VT-CSI02` (Buổi 14 SPCK)
- **Cột 3 SPCK:** **`4/4` `VERIFIED`** (`Bùi Nguyễn Nhật Quân` 5 ảnh app + ảnh cá nhân, `Đặng Quang Thảo` 2 ảnh web + Logo MindX, `Kim Đắc Trường` dọn sạch `10/10` tệp cũ & tải `5` tệp mới + 1 ảnh web + ảnh cá nhân, `Trần Minh Khang` cập nhật `app.py` lên Drive & LMS + ảnh cá nhân, ghi nhận `0` ảnh app do bài dùng Streamlit).
- **Cột 2 Đánh giá + Summary:** **`4/4` `VERIFIED`** (`4.50`, `4.38`, `4.26`, `3.88`) + `Summary VERIFIED`.
- **Tiến độ Teaching:** `100%` (`20/20` mục, `VERIFIED`).
- **Phiếu điểm cuối khóa Teaching:** `VERIFIED` (`79` mục điểm đồng bộ, `4/4` học viên khớp, `0` lỗi).
