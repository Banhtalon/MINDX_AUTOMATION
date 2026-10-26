# BÁO CÁO KIỂM TOÁN ĐỐI KHÁNG VÒNG 40 (`AUDIT-R40`) — GIAI ĐOẠN 7 (`TASK-7.1` .. `TASK-7.3`)

- **Phiên kiểm toán Codex CLI:** `01a15d6d-6cce-7e71-bd59-ad68bac6237a` (`gpt-6.1-sol`, `reasoning_effort = high`)
- **Phạm vi:** Giai đoạn 7 (`TASK-7.1` .. `TASK-7.3`: Màn hình Quản lý Giáo trình `/syllabus-config`, Barem Chấm Điểm, Thanh Live Log Drawer & Bộ khởi chạy 1 chạm `start-bot.bat` / `start-bot.command`).
- **Quyết định kiểm toán:** **CHƯA ĐẠT (`NO-GO` cấp mã nguồn Giai đoạn 7)** — Phát hiện **8 nhóm lỗi (`R40-01` .. `R40-08`)** qua bộ kiểm thử đối kháng `docs/audits/round-40/adversarial.mjs` (**35 / 65 PASS, 30 FAIL**).

---

## 1. Kết quả các cổng kiểm thử trong bản sao cô lập (`$env:TEMP\mindx-round40-phase7`)

| Cổng kiểm thử | Lệnh thực thi | Kết quả |
| :--- | :--- | :---: |
| **1. Kiểm thử tích hợp Giai đoạn 7** | `node --import tsx scripts/test-phase7.ts` | **PASS** (`exit 0`) |
| **2. Kiểm thử tích hợp Giai đoạn 6** | `node --import tsx scripts/test-phase6.ts` | **PASS** (`exit 0`) |
| **3. Kiểm thử tích hợp Giai đoạn 5** | `node --import tsx scripts/test-phase5.ts` | **PASS** (`exit 0`) |
| **4. Kiểm tra kiểu tĩnh TypeScript** | `tsc --noEmit --incremental false` | **0 lỗi** (`exit 0`) |
| **5. Bộ kiểm thử đối kháng Vòng 40** | `node --import tsx docs/audits/round-40/adversarial.mjs` | **35 / 65 PASS, 30 FAIL** (`exit 1`) |

---

## 2. Danh sách 8 nhóm phát hiện cần khắc phục (`R40-01` .. `R40-08`)

1. **`R40-01` (P1 — Chấp nhận mảng cấu hình rỗng hoặc tự ép kiểu/lọc bỏ âm thầm dữ liệu cấu hình sai định dạng):**
   - `saveCoursesSyllabus`, `saveGradingRubrics`, `saveQuickTags`, `saveZaloTemplates` cho phép lưu mảng rỗng `[]`, tự ép `courseCode` kiểu object thành `"[OBJECT OBJECT]"`, tự biến `sessions`/`tags` không phải mảng thành `[]`, tự ép `sessionNumber <= 0` hoặc số thập phân `0.2`, cho phép `topic` rỗng, và âm thầm lọc bỏ mẫu Zalo lỗi thay vì trả về HTTP 400.
2. **`R40-02` (P1 — Thiếu chặn trùng mã định danh con và lỗi sinh trùng mã tiêu chí trên UI):**
   - Chưa chặn trùng `sessionNumber` trong cùng khóa học, trùng `criterionId` trong cùng barem, trùng `category` hoặc `tag.id` trong Quick Tags, trùng `id` trong Mẫu Zalo; đồng thời nút `+ Thêm tiêu chí` trên `/syllabus-config` dùng `C${criteria.length + 1}` gây trùng `criterionId` sau khi xóa tiêu chí đầu.
3. **`R40-03` (P1 — Điểm tối đa tiêu chí `maxPoints` không hợp lệ vẫn được ép về `1` hoặc làm tròn về `0`):**
   - Các giá trị `maxPoints` âm (`-5`), bằng `0`, `NaN`, `null`, `true`, tràn số `1e309` (`Infinity`), hoặc số dương quá nhỏ làm tròn thành `0` (`0.001`) không bị từ chối bằng HTTP 400.
4. **`R40-04` (P2 — Ghi đè mất dữ liệu khi 2 phiên cùng mở và lưu cấu hình nối tiếp):**
   - Khi hai phiên cùng đọc `GET /api/config` rồi lần lượt `POST /api/config`, phiên lưu sau ghi đè toàn bộ thay đổi vừa lưu của phiên trước mà không phát hiện xung đột (`409`) hoặc hợp nhất.
5. **`R40-05` (P1 — Nút Dừng khẩn cấp `Stop Bot` chưa ngắt vòng lặp chấm/lưu điểm hàng loạt Giai đoạn 5 giữa các học viên):**
   - Trong `HomeworkGradeWorker.saveApprovedGrades`, khi bấm `Stop Bot` lúc đang xử lý học viên 1, vòng lặp vẫn tiếp tục chạy sang học viên 2.
6. **`R40-06` (P2 — `start-bot.bat` dùng `%errorlevel%` bên trong khối ngoặc `if not exist "node_modules" (...)`):**
   - Trong `cmd.exe`, `%errorlevel%` trong khối ngoặc được nội suy sớm từ trước khi `call npm install` chạy, khiến lệnh cài đặt thất bại (`exit /b 37`) vẫn không dừng script.
7. **`R40-07` (P2 — Phản hồi Lưu cấu hình về trễ ghi đè lên nội dung giáo viên vừa gõ thêm trên `/syllabus-config`):**
   - Khi đang chờ phản hồi `POST /api/config`, nếu giáo viên gõ sửa tiếp trên ô nhập liệu, lúc phản hồi cũ trả về hàm `setCourses(data.courses)` ghi đè mất chữ vừa gõ.
8. **`R40-08` (P2 — `SequentialTaskQueue` chưa phát bản tin `status` cuối cùng với `isRunning: false` khi hàng đợi về trạng thái nghỉ):**
   - Trong `processNext()`, `emitStatus()` chỉ gọi trong khối `finally` khi `isProcessing` còn `true`, thiếu một nhịp `emitStatus()` sau khi đặt `this.isProcessing = false`.
