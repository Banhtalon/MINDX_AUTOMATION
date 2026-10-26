# BÁO CÁO PHÚC TRA ĐỘC LẬP VÒNG 39 (`AUDIT-R39`) — GIAI ĐOẠN 6 (`TASK-6.1` .. `TASK-6.5`)

- **Phiên kiểm toán Codex CLI:** `01a15d27-1e12-74b1-8c68-a32a42165bca` (`gpt-6.1-sol`, `reasoning_effort = high`)
- **Phạm vi:** Giai đoạn 6 — Luồng 4: Tự động Upload Sản phẩm Cuối khóa SPCK (`TASK-6.1` .. `TASK-6.5`) & đóng toàn bộ 12 nhóm phát hiện của `AUDIT-R38` (`R38-01` .. `R38-12`).
- **Quyết định nghiệm thu:** **ĐẠT (`GO` cấp mã nguồn Giai đoạn 6)** — Đóng dứt điểm **12/12** nhóm phát hiện (`5 P1`, `7 P2`).

---

## 1. Kết quả chạy 5 cổng kiểm định trong bản sao cô lập (`$env:TEMP\mindx-round31-r38-phase6`)

| Cổng kiểm định | Lệnh thực thi | Kết quả | Bằng chứng |
| :--- | :--- | :---: | :--- |
| **1. Hồi quy Vòng 32 (`r32-compatible`)** | `node --import tsx docs/audits/round-38/r32-compatible.mjs` | **67 / 67 PASS** (`exit 0`) | `evidence/01-r32-compatible.log`, `evidence/r32-phase6-results.json` |
| **2. Bộ kiểm thử đối kháng Vòng 38 (`adversarial`)** | `node --import tsx docs/audits/round-38/adversarial.mjs` | **41 / 41 PASS** (`exit 0`) | `evidence/02-adversarial.log`, `evidence/r38-adversarial-results.json` |
| **3. Kiểm thử tích hợp Giai đoạn 6** | `node node_modules/tsx/dist/cli.mjs scripts/test-phase6.ts` | **PASS 100%** (`exit 0`) | `evidence/03-phase6.log` |
| **4. Kiểm thử tích hợp Giai đoạn 5** | `node node_modules/tsx/dist/cli.mjs scripts/test-phase5.ts` | **PASS 100%** (`exit 0`) | `evidence/04-phase5.log` |
| **5. Kiểm tra kiểu tĩnh TypeScript** | `node node_modules/typescript/bin/tsc --noEmit --incremental false` | **0 lỗi** (`exit 0`) | `evidence/05-typescript.log` |

---

## 2. Xác nhận đóng 12/12 phát hiện của Vòng 38 (`R38-01` .. `R38-12`)

1. **`R38-01` (P1 — ĐÃ ĐÓNG):** Không còn coi link vừa bấm `+ Thêm` trên form là bằng chứng máy chủ đã lưu nếu phản hồi Lưu rỗng `{}` và thiếu xác nhận `persisted`/`SAVED`/dữ liệu máy chủ.
2. **`R38-02` (P1 — ĐÃ ĐÓNG):** Khóa chặt cả chiều gửi (`variables.classId`, `variables.studentId`) lẫn phản hồi trả về của API Lưu SPCK theo đúng học viên và lớp đang xử lý.
3. **`R38-03` (P1 — ĐÃ ĐÓNG):** Chặn bấm nút `Lưu` khi còn file đang tải dở (`window.pendingFiles > 0` hoặc `.ant-upload-list-item-uploading`) và bỏ qua các gói mạng `/telemetry` không phải upload file thật.
4. **`R38-04` (P1 — ĐÃ ĐÓNG):** Không tin file trùng tên có sẵn từ trước trên thẻ LMS nếu chưa có dấu xác thực `contentHash` khớp với bản giáo viên vừa duyệt.
5. **`R38-05` (P1 — ĐÃ ĐÓNG):** Nút **Dừng khẩn cấp (`Stop Bot`)** ngắt ngay vòng lặp gọi AI hàng loạt và vòng lặp upload SPCK nhiều học viên giữa các học viên kế tiếp.
6. **`R38-06` (P2 — ĐÃ ĐÓNG):** Kiểm tra chặt cấu trúc gói nhị phân của các tệp đính kèm `.zip`, `.sb3`, `.yyz`, `.docx`, `.pptx` (chặn tệp rỗng/hỏng cấu trúc ngay từ bước quét, duyệt và trước khi upload).
7. **`R38-07` (P2 — ĐÃ ĐÓNG):** Chặn triệt để các URL phi `http/https` (`javascript:`, `file:`, `data:`) và kiểm tra đúng tên miền YouTube (`youtube.com`, `youtu.be`) ở cả bước duyệt và trước khi upload.
8. **`R38-08` (P2 — ĐÃ ĐÓNG):** Khóa cứng danh sách đuôi tệp cho phép (`ALLOWED_ATTACHMENT_EXTENSIONS`, `ALLOWED_IMAGE_EXTENSIONS`), chặn các tệp `.exe` hoặc đuôi lạ được chèn qua nháp.
9. **`R38-09` (P2 — ĐÃ ĐÓNG):** Gắn mã phiên giao diện (`clientSessionId`) khi lưu nháp để sau khi tải lại trang (`F5`), thao tác sửa mới không bị nhầm là gói tin cũ.
10. **`R38-10` (P2 — ĐÃ ĐÓNG):** Khóa chọn lớp khi đang chạy Duyệt/Upload/AI và kiểm tra đúng mã lớp trước khi cập nhật bảng giao diện.
11. **`R38-11` (P2 — ĐÃ ĐÓNG):** Chụp đầy đủ trạng thái dòng (gồm cả `teacherNote`, `quickTags`, `includePresentation`, danh sách file/link) trước khi gọi AI để phản hồi AI trễ không ghi đè lên chỉnh sửa mới của giáo viên.
12. **`R38-12` (P2 — ĐÃ ĐÓNG):** Tổng hợp lịch sử học tập cho AI SPCK đọc toàn bộ các buổi học của học viên trong lớp thay vì chỉ đọc buổi 1.

---

## 3. Toàn vẹn tệp bảo vệ & Dọn dẹp

- Đã xóa sạch bản sao tạm `$env:TEMP\mindx-round31-r38-phase6` và các fixture tạm (`evidence/cleanup.json`).
- Bảo toàn **1.829 / 1.829** tệp bảo vệ (gồm `next-env.d.ts` với `SHA-256 = B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000` và toàn bộ hồ sơ lịch sử `docs/audits/round-12` .. `docs/audits/round-38`).
