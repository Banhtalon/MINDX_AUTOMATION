# BÁO CÁO KIỂM ĐỊNH ĐỘC LẬP GIAO DIỆN & BẢO MẬT `v3.6.2` (`Gemini 4 Argon High` — Round 2 Final)

- **Ngày kiểm định:** 18/11/2026
- **Kiểm định viên độc lập:** `Gemini 4 Argon (High)` (`@argon-ui-verifier`)
- **Phiên bản kiểm định:** `v3.6.2` (Sửa lỗi bố cục & tương phản Light/Dark Mode trên `/final-project` và toàn bộ 7 route + API xem trước ảnh bìa `GET /api/spck/thumbnail`)
- **Kết luận nghiệm thu (Round 2 Final):** **`VERDICT: GO`** (`2/2` phát hiện Vòng 1 `V362-F01` & `V362-F02` đã **CLOSED**; **`0` lỗi P0/P1/P2/P3 mở**)

---

## 1. Xác nhận Bảo toàn 100% Dữ liệu Thật (SHA-256 Trước & Sau Kiểm định Vòng 1 & Vòng 2)

Toàn bộ quá trình chụp màn hình, đo đạc DOM trên `http://127.0.0.1:3000` (chặn mọi request làm thay đổi dữ liệu) và chạy các bộ kiểm thử/probe đối kháng độc lập trong `os.tmpdir()` bảo toàn tuyệt đối `100%` SHA-256 của cả 3 tệp dữ liệu thật:

| Tệp dữ liệu thật | SHA-256 Trước kiểm định | SHA-256 Sau kiểm định (Round 2) | Trạng thái |
| :--- | :--- | :--- | :---: |
| `data/mindx_bot.db` | `32D13255161DFCA608F9943454837926B030D5BCB10E65E55809C5A8D95DDAB1` | `32D13255161DFCA608F9943454837926B030D5BCB10E65E55809C5A8D95DDAB1` | **100% NGUYÊN VẸN** |
| `data/running_classes.json` | `77E206D61B890909338FF6BE964FBD666BD15F92DF59913A820E256DBBAED893` | `77E206D61B890909338FF6BE964FBD666BD15F92DF59913A820E256DBBAED893` | **100% NGUYÊN VẸN** |
| `data/config/lms_class_ids.json` | `0C90FA3EBF2B56746D07807202A8AD1EFA2B68818182D740B2DFB2D21E6A9D2A` | `0C90FA3EBF2B56746D07807202A8AD1EFA2B68818182D740B2DFB2D21E6A9D2A` | **100% NGUYÊN VẸN** |

---

## 2. Kết quả Kiểm tra Trực quan & Đo DOM Thực tế (7 Route × Light/Dark × 3 Kích thước Màn hình)

Đã chụp ảnh màn hình thực tế bằng Chromium Headless độc lập và kiểm tra trực tiếp bằng mắt (`read_file`) kết hợp đo hình học DOM trên `24` tổ hợp route/theme/viewport (`1280x800`, `1366x768`, `1440x900`) cùng toàn bộ các ngăn/modal (`Chi tiết ▾` Tab 1 & Tab 2, `🧰 Công cụ trong lớp học ▾`, `⚙️ Tùy chọn nâng cao ▾`, `SnapshotModal`, `FolderBrowserModal`, 5 tab `/admin-center`, 2 tab `/syllabus-config`):

1. **Khắc phục triệt để 6 lỗi giao diện trong ảnh chụp của Owner trên `/final-project?classId=VT-C4K-PTA13&sessionNumber=13` (`☀️ Sáng`):**
   - **3 ô `B.12 / B.13 / B.14` (`spck-slot-pill-12/13/14`):** Không còn bị ép hẹp hay đè chữ. Ngay cả ở màn hình laptop `1280x800` và `1366x768`, toàn bộ 15/15 ô của `VT-C4K-PTA13`, 24/24 ô của `VT-C4K-GA38`, và 30/30 ô của `VT-JSB16` đều đạt `width = 96px` (`>= 82px`), `pillOverlaps = 0`.
   - **Ảnh bìa thật `16:9` của từng học viên:** Hiển thị `100%` ảnh bìa thật (`5/5` ở `VT-C4K-PTA13`, `8/8` ở `VT-C4K-GA38`, `10/10` ở `VT-JSB16`, `naturalWidth > 0`) cả ở khung `80x45px` trên dòng tóm tắt lẫn khung `112x64px` trong `Chi tiết ▾`.
   - **Menu `<select>` học viên sạch sẽ:** Bỏ hoàn toàn mã thô `(STU_...)` trên các tên duy nhất; chỉ gắn hậu tố 6 ký tự cuối `(${studentId.slice(-6)})` khi lớp có học viên trùng họ tên (`duplicateNameSet`).
   - **Tinh gọn nút công cụ dòng học viên:** Nút `🔄 Làm mới trọn gói` & `⏪ Khôi phục bản trước` đã được chuyển vào thanh công cụ trong `Chi tiết ▾`.
   - **Ô xem trước nhận xét 2 dòng (`spck-clean-comment-preview`):** Tách `px-2.5 py-1.5` ra thẻ bao ngoài, giữ `.line-clamp-2` có `paddingTop = 0, paddingBottom = 0` (`clampedPaddingIssues = 0`), không còn cắt lửng dòng 3.
   - **Thanh nộp cố định `SubmitBar` & dải `.spck-handoff-strip`:** Nút `"✈️ 3. Duyệt & Nộp tất cả"` hiển thị chữ trắng `#ffffff` sắc nét trên nền xanh `#2563eb` ở cả Light & Dark Mode; dải `.spck-handoff-strip` gọn 1 dòng, độ tương phản cao.
2. **Độ tương phản & hiển thị trên toàn bộ 7 route (`☀️ Sáng` & `🌙 Tối`):**
   - Trong `FolderBrowserModal` (`"📁 Đổi thư mục"` $\rightarrow$ `"Chọn..."`), tên thư mục con (`01_Bui_Tu_An`, `02_Nguyen_Quynh_Nguyen`...), nút `"Mở ra"`, nút `"Chọn"` và nút ổ đĩa hiển thị rõ nét ở cả Light & Dark Mode (`contrast >= 4.5:1`).
   - Trên `/session-comments`, các nút bật/tắt mục Zalo (`2a. Tình hình chung`, `✓ 2c. Tiến độ SPCK`, `3. Gửi ảnh & Học liệu`) và nút `"Copy nhận xét"` đạt tương phản cao (`>= 4.5:1`) ở cả hai chế độ Sáng/Tối.
   - `0 console.error`, `0 console.warning`, `0 pageerror`, `0` Next.js Dev Overlay Issues, `0` tràn ngang (`scrollWidth === innerWidth`) trên tất cả 7 route.

---

## 3. Kết quả Kiểm toán Bảo mật Đối kháng (`GET /api/spck/thumbnail` & Edge Cases)

Bộ probe đối kháng độc lập `ADV-01..ADV-08` trong `os.tmpdir()` đạt **`8/8 PASS`**:
- **`ADV-01` (Path Traversal `..`, `..\`, `%2e%2e%2f`, URL encoding kép):** Chặn `100%` (`HTTP 403/404`), không thoát khỏi `ALLOWED_LOCAL_DIRS`. **PASS.**
- **`ADV-02` (Symlink / Windows Directory Junction Escape):** `assertPathAllowed` + `fs.lstatSync` chặn `100%` symlink/junction trỏ ra ngoài vùng cho phép (`HTTP 403`). **PASS.**
- **`ADV-03` (Null byte `\0`, `%00` & đường dẫn rỗng/khoảng trắng):** Chặn `100%` (`HTTP 400`). **PASS.**
- **`ADV-04` (Non-local URL hostname, `Host` lạ, `Sec-Fetch-Site: cross-site`, `Origin` ngoài):** `validateLocalRequest` chặn `100%` (`HTTP 403`). **PASS.**
- **`ADV-05` (Đuôi `.svg`/`.html`, giả mạo magic bytes chứa `<script>` trong `.png`, tệp `< 12` bytes, tệp rỗng `0-byte`, thư mục mang tên `.png`):** Trả `HTTP 415` cho định dạng/magic bytes giả mạo và `HTTP 403` cho tệp `0-byte` hoặc thư mục. **PASS.**
- **`ADV-06` (Tệp ảnh hợp lệ `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`):** Trả `HTTP 200` kèm `Content-Type` chuẩn, `X-Content-Type-Options: nosniff`, `Cache-Control: private, max-age=120`. **PASS.**
- **`ADV-07` & `ADV-08` (Trùng họ tên học viên `<select>` & tương thích `docs/audits/round-38/adversarial.mjs`):** Logic `duplicateNameSet` + mốc cắt `node:vm` harness và quy tắc không rò rỉ biến nhạy cảm ở Client giữ nguyên `100%`. **PASS.**

---

## 4. Kết quả Chạy 5 Cổng Kiểm thử Bắt buộc (Round 2)

| STT | Lệnh kiểm thử bắt buộc | Kết quả Round 2 | Ghi chú |
| :---: | :--- | :---: | :--- |
| 1 | `node .\node_modules\typescript\bin\tsc --noEmit --incremental false` | **PASS (`exit 0`)** | `0` lỗi TypeScript |
| 2 | `.\node_modules\.bin\tsx.cmd scripts\test-ui-v362.ts` | **PASS (`exit 0`)** | `UI362-01..04` PASS (`FolderBrowserModal` + Zalo contrast `>= 4.5`) |
| 3 | `.\node_modules\.bin\tsx.cmd scripts\test-spck-v360.ts` | **PASS (`exit 0`)** | `V360-01..05` + `Round-38` PASS |
| 4 | `.\node_modules\.bin\tsx.cmd scripts\test-spck-streamlined-v355.ts` | **PASS (`exit 0`)** | `R355-01..05` PASS |
| 5 | `.\node_modules\.bin\tsx.cmd scripts\test-streamline-v340-s5a.ts` | **PASS (`exit 0`)** | `S5a-T1..T4` (`9/9` kịch bản khớp `100%` từng byte, cô lập trong `os.tmpdir()`) |

---

## 5. Nhật ký Đóng Phát hiện Vòng 1 (`2/2 CLOSED`)

| Mã phát hiện | Mức độ | Tóm tắt phát hiện Vòng 1 | Cách khắc phục & Xác minh Vòng 2 | Trạng thái |
| :---: | :---: | :--- | :--- | :---: |
| **`V362-F01`** | **P2** | Trong `FolderBrowserModal.tsx` và các nút nền bán trong suốt `/20` hoặc không nền trên `/session-comments`, chữ `text-slate-200` / `text-emerald-300` / `text-purple-300` bị `:not(button)` loại trừ ở Light Mode nên có tương phản thấp (`1.26:1` – `1.85:1`). | Đã bổ sung quy tắc thích ứng Light Mode cho `<button>` không nền và `<button>` nền bán trong suốt `/10..30` tại `src/app/globals.css:540–594`, cập nhật `FolderBrowserModal.tsx` & `session-comments/page.tsx`, và khóa bằng `[UI362-04]` trong `scripts/test-ui-v362.ts`. Chụp kiểm tra trực quan Round 2 (`r2_folder_modal_light.png`, `r2_session_comments_zalo_light.png`) xác nhận chữ đậm rõ nét (`contrast >= 4.5:1`). | **CLOSED** |
| **`V362-F02`** | **P2** | `scripts/test-streamline-v340-s5a.ts` lỗi `ERR_INVALID_ARG_VALUE` (`mode: 'transform'`) trên Node.js `v26.13.1` và ghi đè ảnh chụp vào `docs/audits/v340/s5a-screenshots` trong cây Git. | Đã đổi sang `{ mode: "strip" }` tại dòng `152`, chuyển `screenshotDir` mặc định vào `tempBuildDir` trong `os.tmpdir()` (tự dọn sạch trong `finally`), thêm `--hide-scrollbars` & `document.body.normalize()`. Chạy lại `scripts/test-streamline-v340-s5a.ts` đạt `PASS 100%` (`exit 0`, `9/9` kịch bản khớp từng byte) và không làm bẩn `git status`. | **CLOSED** |
