# BÁO CÁO NGHIỆM THU ĐỘC LẬP `v3.5.1` — ARGON HIGH (`Model: pro`, Round 2)

- **Ngày nghiệm thu:** `2026-11-15`
- **Phiên bản:** `v3.5.1` (AI Chấm Nháp & Câu Hỏi BGK Trên Google Sheet Demo Buổi 12/13/14, Bộ Mẫu GameMaker `GB`/`GA`/`GI`, Miễn Demo/SPCK Cho `PTB`/`CSB`, Và Sửa Lỗi Nộp Lại SPCK Buổi 13/14 + Thay Thế Sạch Tệp Google Drive)
- **Người kiểm định độc lập:** Subagent **Argon High** (`Model: pro`, được Owner phê duyệt thay thế Codex CLI trong đợt hạn mức OpenAI)
- **Môi trường kiểm định:** Thư mục cô lập `$env:TEMP\mindx-argon-review-v351` (tách hoàn toàn khỏi dữ liệu thật `data/mindx_bot.db`, `data/running_classes.json`, `.env*` và `./playwright-auth`)
- **Kết luận cuối cùng (Round 2):** **`VERDICT: GO`** (`0` lỗi P0/P1/P2/P3 còn tồn đọng)

---

## 1. Các Phát Hiện Vòng 1 & Trạng Thái Đóng Lỗi Tại Vòng 2

| Mã | Mức độ | Mô tả phát hiện tại Round 1 | Tệp xử lý | Trạng thái Round 2 |
| :---: | :---: | :--- | :--- | :---: |
| **AH-01** | `P1 — High` | Thiếu `scrollable.dispatchEvent(new Event("scroll", { bubbles: true }))` sau khi thay đổi `scrollable.scrollTop` khiến danh sách ảo hóa `>25` mục trên Google Drive đôi lúc chỉ đọc được 12 mục đầu trên khung nhìn ban đầu. | `src/lib/playwright/spck-drive-uploader.ts`, `src/lib/playwright/spck-demo-sheet.ts` | **CLOSED ✅** |
| **AH-02** | `P1 — High` | `listDriveFilesInFolder` trong trình tạo bảng Demo thiếu shim `window.__name = window.__name \|\| function(f){ return f; }` trước `page.evaluate(...)`. | `src/lib/playwright/spck-demo-sheet.ts` | **CLOSED ✅** |
| **AH-03** | `P2 — Medium` | `escapeXml` chưa loại bỏ các ký tự điều khiển không hợp lệ theo chuẩn XML 1.0 (`[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\uFFFE\uFFFF]`) và lone UTF-16 surrogates. | `src/lib/playwright/spck-demo-sheet.ts`, `scripts/test-demo-ai-and-drive-reupload-v351.ts` | **CLOSED ✅** |

---

## 2. Kết Quả Các Cổng Kiểm Thử Sau Khi Vá Lỗi (Round 2)

- **Tại kho mã chính (`f:\MINDX_project test\MINDX-AUTOMATION`):**
  - `npx tsc --noEmit --incremental false`: **PASS (`0` errors, exit 0)**
  - `npx tsx scripts/test-demo-ai-and-drive-reupload-v351.ts`: **PASS (`5/5`: `T1`–`T5` Đạt 100%)**
  - `npx tsx scripts/test-native-demo-gsheet.ts`: **PASS (`4/4`: `GS-01`..`GS-04` Đạt 100%)**
  - `$env:GRAPHIFY_BACKEND="none"; graphify update .`: **PASS (`1916` nodes, `6832` edges, `85` communities)**
  - Trước 3 bản vá biên Round 1, 4 bộ hồi quy bổ sung (`test-audit-remediation-v341.ts` `12/12`, `test-session14-v290.ts` `7/7`, `test-spck-v270.ts` `16/16`, `test-admin-center-v350.ts` `11/11`) đều đã PASS `exit 0`.
- **Tại môi trường cô lập của Argon High Round 2 (`$env:TEMP\mindx-argon-review-v351`):**
  - `npx tsc --noEmit --incremental false`: **PASS (`0` errors)**
  - `npx tsx scripts/test-demo-ai-and-drive-reupload-v351.ts`: **PASS (`5/5`: `T1`–`T5`)**
  - `npx tsx scripts/test-native-demo-gsheet.ts`: **PASS (`4/4`: `GS-01`..`GS-04`)**
  - Bộ probe đối nghịch độc lập `__argon_probes/probe-v351.ts`: **PASS (`6/6` Probes)**:
    - `Probe 1`: Thoát XML an toàn & lọc ký tự điều khiển XML 1.0 trên 7 khóa tiêu biểu (`GA, GI, PTI, JSI, CSA, CSI, SB`), bảo toàn thẻ `<f>` và tính lại `<v>`.
    - `Probe 2`: Phòng thủ khi AI cố tình hạ điểm Nhóm 3 hoặc tiêu chí thiếu Slide/Video xuống `"Chưa đạt"` -> ép trả 100% về `"Tốt"`.
    - `Probe 3`: Kiểm tra rò rỉ PII (tên có dấu, không dấu, camelCase, snake_case) -> `0%` lọt vào prompt AI.
    - `Probe 4`: Miễn Demo `PTB`/`CSB` trên API, `ToolsDrawer`, Admin Center trong khi vẫn mở luồng nộp SPCK Buổi 14 (`T14`).
    - `Probe 5`: Giả lập lỗi tải Google Drive -> `0` tệp cũ bị xóa hoặc đổi tên.
    - `Probe 6`: Quét & thay thế thực tế trên danh sách Drive ảo hóa `>25` tệp với sự kiện cuộn `scroll`.

---

## 3. Bảo Toàn Dữ Liệu Thật (Live Data SHA-256)

- `data/mindx_bot.db`: `A41832695038BD2F523ADA2A3FF56A816A55D9AC180624731A343E50434AF2D5` (bảo toàn 100% suốt quá trình kiểm định Round 1–2, `integrity_check: ok`).
- `data/running_classes.json`: `2D35BCD333B1BFAD4EE0E11CE0A3FD4FE6D29467AEA1044D01D5677EC25E7026` (bảo toàn 100%).
