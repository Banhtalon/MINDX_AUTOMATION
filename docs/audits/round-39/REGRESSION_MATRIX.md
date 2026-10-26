# MA TRẬN ĐỐI CHIẾU ĐÓNG LỖI & HỒI QUY VÒNG 39 (`AUDIT-R39`)

| Mã phát hiện | Mức độ | Mô tả tóm tắt | Ca kiểm thử xác nhận (`docs/audits/round-38/adversarial.mjs`) | Trạng thái R39 |
| :--- | :---: | :--- | :--- | :---: |
| **`R38-01`** | P1 | Không coi link vừa thêm trên form là bằng chứng lưu server khi response rỗng | `R38-P-optimistic-links` | **CLOSED (`PASS`)** |
| **`R38-02`** | P1 | Khóa chặt `(classId, studentId)` ở cả request và response khi Lưu SPCK | `R38-P-wrong-req-owner` | **CLOSED (`PASS`)** |
| **`R38-03`** | P1 | Chặn bấm Lưu khi còn file đang tải (`pendingFiles`) & bỏ qua `/telemetry` | `R38-P-pending-files` | **CLOSED (`PASS`)** |
| **`R38-04`** | P1 | Không tin file trùng tên có sẵn trên thẻ LMS khi chưa khớp `contentHash` | `R38-P-old-file` | **CLOSED (`PASS`)** |
| **`R38-05`** | P1 | Nút Dừng khẩn cấp (`Stop Bot`) ngắt ngay lượt AI & Upload giữa các học viên | `R38-G-stop`, `R38-P-stop` | **CLOSED (`PASS`)** |
| **`R38-06`** | P2 | Kiểm tra cấu trúc gói nhị phân `.zip`, `.sb3`, `.yyz`, `.docx`, `.pptx` | `R38-S-corrupt-zip`, `R38-S-corrupt-sb3`, `R38-S-corrupt-yyz`, `R38-S-corrupt-docx`, `R38-S-corrupt-pptx` | **CLOSED (`PASS`)** |
| **`R38-07`** | P2 | Chặn URL `javascript:`/`file:` và kiểm tra tên miền YouTube hợp lệ | `R38-D-unsafe-url` | **CLOSED (`PASS`)** |
| **`R38-08`** | P2 | Chặn tệp `.exe` hoặc đuôi ngoài danh sách cho phép khi Duyệt & Upload | `R38-D-exe` | **CLOSED (`PASS`)** |
| **`R38-09`** | P2 | Lưu nháp sau khi tải lại trang (`F5`) không bị bỏ qua do lệch `draftSeq` | `R38-U-reload` | **CLOSED (`PASS`)** |
| **`R38-10`** | P2 | Đổi lớp trong lúc đang Duyệt/Upload không ghi đè dữ liệu sang lớp mới | `R38-U-class-race` | **CLOSED (`PASS`)** |
| **`R38-11`** | P2 | Phản hồi AI về trễ không ghi đè khi giáo viên vừa sửa ghi chú/thẻ/cờ thuyết trình | `R38-U-note-race` | **CLOSED (`PASS`)** |
| **`R38-12`** | P2 | AI SPCK tổng hợp lịch sử học tập từ toàn bộ các buổi học của lớp | `R38-G-history` | **CLOSED (`PASS`)** |

## Tổng hợp các cổng kiểm thử (`evidence/gates.json`)

- `docs/audits/round-38/r32-compatible.mjs`: **67 / 67 PASS**
- `docs/audits/round-38/adversarial.mjs`: **41 / 41 PASS**
- `scripts/test-phase6.ts`: **PASS**
- `scripts/test-phase5.ts`: **PASS**
- `tsc --noEmit --incremental false`: **0 lỗi**
