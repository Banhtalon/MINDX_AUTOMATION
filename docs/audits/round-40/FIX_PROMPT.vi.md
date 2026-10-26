# HƯỚNG DẪN SỬA LỖI SAU KIỂM TOÁN VÒNG 40 (`AUDIT-R40`)

1. **`R40-01` & `R40-02` & `R40-03` (`src/lib/db/json-config.ts` & `src/app/api/config/route.ts`):**
   - Từ chối mảng rỗng `[]` cho `courses`, `rubrics`, `quickTags` (và `zaloTemplates`).
   - Kiểm tra kiểu nghiêm ngặt trước khi chuẩn hóa: không ép object sang chuỗi `"[OBJECT OBJECT]"`, không biến `sessions`/`tags` không phải mảng thành `[]`, không lọc bỏ âm thầm các dòng lỗi.
   - Bắt buộc `sessionNumber` là số nguyên dương (`Number.isInteger(n) && n >= 1`), `topic` không rỗng, `criterion.maxPoints` là số thực hữu hạn dương (`typeof p === "number" && Number.isFinite(p) && p > 0`) và sau khi làm tròn 2 chữ số thập phân vẫn `> 0`.
   - Chặn trùng lặp `sessionNumber` trong cùng khóa học, `criterionId` trong cùng barem, `category` và `tag.id` trong Quick Tags, `id` trong Mẫu Zalo.
   - Trong `/api/config`, kiểm tra chuỗi JSON thô trước/sau `JSON.parse` để từ chối số tràn thành `Infinity` (như `1e309`).
2. **`R40-02` & `R40-07` (`src/app/syllabus-config/page.tsx`):**
   - Khi bấm `+ Thêm tiêu chí`, tạo mã `criterionId` duy nhất (`C1`, `C2`...) chưa từng tồn tại trong `r.criteria` thay vì dùng `C${r.criteria.length + 1}`.
   - Theo dõi bộ đếm chỉnh sửa cho từng phân mục cấu hình; nếu người dùng tiếp tục gõ sửa trong khi request `POST /api/config` đang chờ phản hồi, không ghi đè state form bằng dữ liệu của phản hồi cũ.
3. **`R40-04` (`src/app/api/config/route.ts`):**
   - Theo dõi ảnh chụp dữ liệu tại thời điểm `GET /api/config` và phát hiện khi hai client cùng đọc một phiên bản rồi ghi đè nối tiếp làm mất trường vừa sửa của client trước (trả về `409 Conflict` hoặc hợp nhất an toàn).
4. **`R40-05` (`src/lib/playwright/grade-worker.ts`):**
   - Trong vòng lặp `for (const sub of approvedSubmissions)` của `HomeworkGradeWorker.saveApprovedGrades`, kiểm tra `taskQueue.getStatus().isStopped || (process as any).__mindxQueueStopped` để ngắt ngay trước khi chuyển sang học viên tiếp theo.
5. **`R40-06` (`start-bot.bat`):**
   - Thay `if %errorlevel% neq 0` bên trong khối ngoặc `if not exist "node_modules" (...)` bằng `if errorlevel 1` / `if !errorlevel! neq 0` với `EnableDelayedExpansion`.
6. **`R40-08` (`src/lib/queue/task-queue.ts`):**
   - Trong `processNext()`, gọi thêm `this.emitStatus()` ngay sau khi đặt `this.isProcessing = false; this.currentTask = null;` để bản tin trạng thái cuối cùng luôn có `isRunning: false`.
