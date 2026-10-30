Bạn là Reviewer độc lập (`gpt-6.1-sol` mức `high`) cho dự án **MINDX AUTOMATION BOT — Giai đoạn 10 (`v3.4.0`) — Chặng `S5b` (Vòng 2)**.

Hãy đọc:
1. Báo cáo Vòng 1 tại `docs/audits/v340/CODEX_S5B_ROUND1.md` (7 phát hiện `S5B-01` .. `S5B-07`).
2. `PROJECT_STATE.md`, `MINDX_AUTOMATION_PLAN.md`, `CHANGELOG.md`, `AGENTS.md`, và kế hoạch đã duyệt tại `C:\Users\QQ\.gemini\antigravity\brain\2dc5f134-f73b-44e2-9d14-6c8333eb3c3b\STREAMLINE_PLAN_v340.md` (mục `S5b.1`–`S5b.9`).

## Các bản sửa đã áp dụng cho 7 phát hiện Vòng 1
- **`S5B-01` (HIGH):** Trong `src/components/final-project/useSpckWorkflow.ts` và `src/app/final-project/page.tsx`:
  - `handleCaptureAppScreenshots`, `handleDeployWebToGithubPages`, `handleUploadToGoogleDrive`, `handleImportYoutubeProducts` đều trả về `{ success: boolean, updatedRows: ScannedFolderUIItem[] }` với `draftVersion` và tài nguyên mới nhất từ máy chủ (cũng như từ `persistRowDraft`).
  - Khi `persistRowDraft` thất bại trước khi gọi `/api/spck/deploy-web` hoặc `/api/spck/upload-drive`, hàm gán `setStudentToolError(row.assignedStudentId, "web" | "drive", ...)` và trả về `{ success: false, updatedRows }`.
  - `runAutoPrepAfterScan` duy trì `currentRows` qua từng bước (`Chụp ảnh -> GitHub Pages -> Google Drive` hoặc `Nhập YouTube -> Google Drive`), truyền `sourceRows: currentRows` vào bước kế tiếp nên `expectedVersion` luôn khớp với phiên bản mới nhất trên máy chủ, không còn lỗi HTTP 409.
- **`S5B-02` (HIGH):**
  - Mọi nhánh lỗi sớm trong `handleApproveAndUpload` (`src/app/final-project/page.tsx` — lỗi `persistRowDraft` 409, trùng học viên, `/api/spck/approve` trả lỗi hoặc `approvedIds.length === 0`, `/api/spck/upload-lms` lỗi hoặc exception) đều khởi tạo, lưu `setLastSubmissionSummary(...)` và trả về đối tượng `SpckBatchSubmissionSummaryUI` có `retryStudentIds`.
  - Trong `handleSubmitSession14Combo` (`src/components/final-project/useSpckWorkflow.ts`), khi `partToRun === "both"`, xóa sạch kết quả đợt cũ ở đầu hàm và có thêm fallback bảo vệ nếu `spckRes` không phải object. Nhờ đó khi Phần 1 lỗi sớm, giao diện báo đúng trạng thái lỗi và hiện nút `"🔄 Thử lại riêng phần Sản phẩm"`.
- **`S5B-03` (MEDIUM):**
  - Trong `useSpckWorkflow.ts`, `useEffect` tự đọc Điểm Demo kiểm tra `const hasMissingDemoScore = session14Evals.some((ev) => !(Number(ev.demoTotalScore) > 0))` (thay vì `some > 0`), đồng thời truyền `onlyMissingStudents: true` xuống `/api/spck/session14-eval/import-demo-scores` (`src/lib/local-files/spck-demo-score-reader.ts`). Những học viên đã có điểm Demo dương được giữ nguyên điểm hiện có, chỉ tự điền cho các học viên còn `demoTotalScore === 0`.
- **`S5B-04` (MEDIUM):**
  - Tại cả 3 điểm tự chọn học viên ở Buổi 13 trong `src/app/final-project/page.tsx` (`loadClassData`, `handleScanFolder`, `effectiveSelectedStudentIds`), luôn trả về `unsubmittedIds` cho Buổi 13 kể cả khi `unsubmittedIds.length === 0` (`0/N`), không rơi về chọn toàn bộ lớp.
- **`S5B-05` (MEDIUM):**
  - Bổ sung `evalVerifiedStudentIds` vào `Session14ComboStatusUI` (`src/components/final-project/types.ts`) và trả về `verifiedStudentIds` từ `handleApproveAndUploadSession14Eval`.
  - Khi chạy `partToRun === "spck_only"` hoặc `"eval_only"`, `handleSubmitSession14Combo` hợp nhất kết quả theo `studentId` (Set union) với các học viên đã `VERIFIED` trước đó trong cùng đợt nộp gộp (`1 + 1 = 2` và không cộng trùng nếu thử lại nhiều lần).
- **`S5B-06` (MEDIUM):**
  - Đã sửa truy cập `aiRes.outboundPromptSample` trong `scripts/test-streamline-v340-s5.ts`; `npx tsc --noEmit --incremental false` đạt `exit 0`.
- **`S5B-07` (MEDIUM):**
  - Thống nhất ma trận 5 nhánh tự chạy công cụ sau khi Quét trong cả `STREAMLINE_PLAN_v340.md` và `useSpckWorkflow.ts` (`Web`: Chụp ảnh → GitHub Pages → Drive; `App/Python/Scratch/Game`: Chụp ảnh → Drive; `Canva/Thiết kế`: Drive; `Robotics có Playlist`: Nhập YouTube → Drive; `Robotics không có Playlist`: Drive), và mở rộng regex mã lớp (`[A-Z0-9]*\b`) + bài kiểm thử tự động trong `scripts/test-streamline-v340-s5.ts`.

## Yêu cầu kiểm định
1. **Bảo vệ dữ liệu thật:** Luôn đặt `ALLOWED_LOCAL_DIRS=$env:TEMP`, `MINDX_DB_PATH="$env:TEMP\codex_s5b_r2.db"`, `MINDX_RUNNING_CLASSES_PATH="$env:TEMP\codex_s5b_r2_classes.json"` trước mọi lệnh chạy. Tuyệt đối không chạm vào `data/mindx_bot.db` hoặc `data/running_classes.json` thật. Không sửa mã nguồn sản phẩm hoặc bài kiểm thử sản phẩm.
2. Kiểm tra lại toàn bộ 7 mục `S5B-01` .. `S5B-07` cùng các cổng kiểm thử (`npx tsc --noEmit --incremental false`, `npx tsx scripts/test-streamline-v340-s5.ts`, `npx tsx scripts/test-streamline-v340-s5a.ts`, v.v.).
3. Ghi báo cáo kiểm định đầy đủ bằng tiếng Việt vào `docs/audits/v340/CODEX_S5B_ROUND2.md` kèm kết luận **Verdict: GO** hoặc **NO-GO**.
