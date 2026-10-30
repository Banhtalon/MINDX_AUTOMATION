Bạn là Reviewer độc lập (`gpt-6.1-sol` mức `high`) cho dự án **MINDX AUTOMATION BOT — Giai đoạn 10 (`v3.4.0`) — Chặng `S5b` (Vòng 3)**.

Hãy đọc:
1. Báo cáo Vòng 2 tại `docs/audits/v340/CODEX_S5B_ROUND2.md` (trong đó 6/7 mục `S5B-01`, `S5B-03`, `S5B-04`, `S5B-05`, `S5B-06`, `S5B-07` đã **CLOSED**, còn 1 điểm `S5B-02-R2` ở mức `MEDIUM`).
2. `PROJECT_STATE.md`, `MINDX_AUTOMATION_PLAN.md`, `CHANGELOG.md`, `AGENTS.md`, và kế hoạch đã duyệt tại `C:\Users\QQ\.gemini\antigravity\brain\2dc5f134-f73b-44e2-9d14-6c8333eb3c3b\STREAMLINE_PLAN_v340.md` (mục `S5b.1`–`S5b.9`).

## Bản sửa đã áp dụng cho `S5B-02-R2`
- Trong `src/components/final-project/useSpckWorkflow.ts` (`handleSubmitSession14Combo`):
  - Ngay khi bắt đầu `partToRun === "both"` (trước lần `await` đầu tiên), hàm xóa sạch `setLastSubmissionSummary(null)` và `setBannerMessage(null)`, đồng thời đặt lại toàn bộ trạng thái hiển thị của `session14ComboStatus` (`spckSummary: null`, `evalVerifiedCount: 0`, `evalVerifiedStudentIds: []`, `evalFailedCount: 0`, `evalRetryStudentIds: []`, `evalErrorMessage: null`, `running: true`, `currentPhase: "spck"`).
  - Với các nhánh thử lại riêng (`"spck_only"` hoặc `"eval_only"`), giữ nguyên kết quả đã tích lũy của phần còn lại.
- Trong `src/components/final-project/SubmitBar.tsx`:
  - Khi `currentPhase === "spck"` của đợt mới mà Phần 2 chưa có kết quả (`evalVerifiedCount === 0`, `evalFailedCount === 0`, `evalRetryStudentIds.length === 0`, `!evalErrorMessage`), hiển thị `"Chưa chạy trong đợt này"` thay vì thông báo kết quả cũ.
- Trong `scripts/test-streamline-v340-s5.ts`:
  - Đã bổ sung kịch bản kiểm thử tự động cho `S5B-02-R2`: chạy Đợt A có lỗi ở Phần 2 (`1 học viên xác minh, 1 cần thử lại`), sau đó bấm `"🚀 Nộp Buổi 14 đầy đủ"` bắt đầu Đợt B mới và giữ yêu cầu `save-draft` đầu tiên ở trạng thái chờ (`__delaySaveDraftOnce`) để kiểm tra giao diện **trước khi hoàn tất** (đảm bảo đã xóa ngay số xác minh/thử lại, thông báo lỗi, bảng kết quả cũ và nút thử lại của Đợt A), rồi giải phóng để kiểm tra lỗi sớm 409 ở Phần 1 và retry riêng từng phần.

## Yêu cầu kiểm định Vòng 3
1. **Bảo vệ dữ liệu thật:** Luôn đặt `ALLOWED_LOCAL_DIRS=$env:TEMP`, `MINDX_DB_PATH="$env:TEMP\codex_s5b_r3.db"`, `MINDX_RUNNING_CLASSES_PATH="$env:TEMP\codex_s5b_r3_classes.json"` trước mọi lệnh test. Tuyệt đối không ghi đè `data/mindx_bot.db` hay `data/running_classes.json`.
2. **Kiểm tra đóng lỗi `S5B-02-R2` và toàn bộ cổng kiểm thử:**
   - Kiểm tra lại kịch bản `S5B-02-R2` (trạng thái màn hình khi yêu cầu đầu tiên của đợt `both` mới còn đang chờ, sau khi trả lỗi sớm và khi retry riêng từng phần) cùng sự toàn vẹn của 6 mục đã đóng (`S5B-01`, `S5B-03`..`S5B-07`).
   - Chạy `npx tsc --noEmit --incremental false` và `npx tsx scripts/test-streamline-v340-s5.ts` (cùng các cổng kiểm thử liên quan).
3. **Ghi biên bản kiểm định:**
   - Ghi báo cáo đầy đủ vào `docs/audits/v340/CODEX_S5B_ROUND3.md` với kết luận rõ ràng: **Verdict: GO** hoặc **NO-GO**.
   - Không tự sửa code ứng dụng và không chạy `git commit`.
