# AUDIT-R33 — Kiểm Định Độc Lập Giai Đoạn 6 (Tự Động Upload SPCK: Máy -> LMS)

**Phán quyết: ĐẠT (GO) cấp mã nguồn cho Giai đoạn 6.** Bộ kiểm định độc lập đạt **67/67 ca (100% PASS)**, đóng toàn bộ **13 nhóm lỗi mở (`R32-01`..`R32-13`)** của vòng kiểm toán trước. Toàn bộ cổng tích hợp Phase 6, hồi quy Phase 5 và kiểm tra kiểu dữ liệu TypeScript (`tsc --noEmit --incremental false`) đều đạt 0 lỗi.

## 1. Môi trường kiểm định & Ranh giới an toàn

- **Thời điểm kiểm định:** 21/10/2026
- **Môi trường chạy:** Cô lập hoàn toàn trong thư mục tạm vật lý `$env:TEMP\mindx-round31-r32-r33-review` (không sao chép `.env*`, `data/mindx_bot.db`, `playwright-auth`; đã dọn dẹp hoàn toàn sau khi trích xuất bằng chứng).
- **Bảo toàn di sản:**
  - `next-env.d.ts`: Giữ nguyên tuyệt đối (`SHA-256: B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000`).
  - Các hồ sơ kiểm toán lịch sử `docs/audits/round-12` .. `docs/audits/round-32`: Giữ nguyên 100%, không chỉnh sửa.
- **Bằng chứng chi tiết:** [phase6-results.json](evidence/phase6-results.json) và [REGRESSION_MATRIX.md](REGRESSION_MATRIX.md).

## 2. Kết quả các cổng kiểm định

| Cổng kiểm định | Lệnh thực thi trong TEMP | Kết quả | Nhận định |
|---|---|---|---|
| Kiểm định độc lập Phase 6 (`R32`/`R33`) | `node --import tsx docs/audits/round-32/verify-phase6.mjs` | **67/67 PASS** (exit 0) | Đóng toàn bộ 13 nhóm lỗi `R32-01`..`R32-13` |
| Kiểm thử tích hợp Giai đoạn 6 | `node node_modules/tsx/dist/cli.mjs scripts/test-phase6.ts` | **PASS** (exit 0) | Đạt 4/4 cụm nhiệm vụ `TASK-6.1`..`TASK-6.5` |
| Kiểm thử hồi quy Giai đoạn 5 | `node node_modules/tsx/dist/cli.mjs scripts/test-phase5.ts` | **PASS** (exit 0) | Đạt 7/7 cụm kiểm thử chấm bài tập đa định dạng |
| Kiểm tra kiểu tĩnh TypeScript | `node node_modules/typescript/bin/tsc --noEmit --incremental false` | **0 lỗi** (exit 0) | Toàn bộ mã nguồn tuân thủ chặt chẽ kiểu dữ liệu |

## 3. Tóm tắt xác nhận đóng 13 nhóm lỗi (`R32-01` .. `R32-13`)

1. **`R32-01` (CLOSED):** API `/api/spck/approve` bắt buộc truyền đầy đủ snapshot `reviewedItems`, đối chiếu toàn bộ trường tài nguyên/link/xác nhận và duyệt nguyên khối trong một transaction SQLite (`R32-A01`..`R32-A05` PASS).
2. **`R32-02` (CLOSED):** Chuẩn hóa đường dẫn thực (`realpath` + canonical path key) chống gán trùng một thư mục cho 2 học viên qua biến thể `../` hoặc `/` vs `\` (`R32-M01`..`R32-M03` PASS).
3. **`R32-03` (CLOSED):** Khi quét lại thư mục mới có tên mơ hồ hoặc thay đổi đường dẫn, hệ thống tự động xóa cờ xác nhận cũ để buộc giáo viên xác nhận lại (`R32-M04` PASS).
4. **`R32-04` (CLOSED):** Khóa dấu vân tay SHA-256 cấp độ byte của toàn bộ file đính kèm/ảnh/thumbnail trong `computeSpckContentHash` và kiểm tra lại chữ ký media trước khi upload (`R32-D03`, `R32-D04` PASS).
5. **`R32-05` (CLOSED):** `SpckUploader` chỉ chấp nhận phản hồi lưu đúng nghiệp vụ (`SaveStudentSpck`, `success !== false`, `status !== 'REJECTED'`) và đối chiếu dữ liệu đã lưu thay vì chỉ đọc giá trị ô input vừa điền (`R32-P05`..`R32-P07` PASS).
6. **`R32-06` (CLOSED):** Kiểm tra lại tính toàn vẹn bản ghi và file trong DB ngay sát thời điểm trước khi bấm nút Lưu (`saveCalls === 0` khi dữ liệu bị sửa trong lúc điền form — `R32-P12` PASS).
7. **`R32-07` (CLOSED):** Bộ ẩn danh `anonymizeSpckText` che kín tên riêng có dấu/không dấu của cả học viên mục tiêu lẫn bạn cùng nhóm trước khi gửi sang Gemini (`R32-G03`, `R32-G04` PASS).
8. **`R32-08` (CLOSED):** Khóa phiên bản gói dữ liệu đầu vào khi gọi AI (tránh ghi đè khi tiêu đề/dự án đổi trong lúc chờ) và giữ nguyên nhận xét đã duyệt khi gọi AI thiếu dữ kiện (`R32-G08`, `R32-G09` PASS).
9. **`R32-09` (CLOSED):** Khóa thứ tự bản nháp (`draftSeq`) ở cả API và giao diện, không để phản hồi lưu nháp/AI đến muộn ghi đè nội dung mới, và dừng ngay quy trình duyệt/upload nếu lưu nháp lỗi (`R32-M06`, `R32-U02`..`R32-U04` PASS).
10. **`R32-10` (CLOSED):** Giao diện không tự động tích chọn Quick Tags thay giáo viên khi nạp DB; bộ lọc hậu kiểm loại bỏ triệt để các câu nhận xét về kỹ năng nói trước đám đông/khán giả khi không bật mục thuyết trình (`R32-G06`, `R32-U01` PASS).
11. **`R32-11` (CLOSED):** Cho phép chuyển quyền ghép thư mục từ học viên cũ sang học viên mới một cách an toàn khi giáo viên đổi lựa chọn trên giao diện (`R32-M05` PASS).
12. **`R32-12` (CLOSED):** Bắt buộc xác minh có control upload Thumbnail và có sự kiện/phản hồi tải file hoàn tất thực sự, không bị đánh lừa bởi tên file xuất hiện trong văn bản nhận xét (`R32-P08`..`R32-P10` PASS).
13. **`R32-13` (CLOSED):** Khóa định danh đúng khung `Sản Phẩm Học Viên 01` (từ chối ghi nhầm vào card `03`) và kiểm tra trùng link theo token URL chính xác thay vì chuỗi con (`R32-P13`, `R32-P14` PASS).
