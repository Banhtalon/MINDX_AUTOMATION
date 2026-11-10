# Kiểm định Quy tắc Miễn Nộp SPCK Học Viên Vắng Mặt Ở Buổi 12/13 & Bắt Buộc Nộp Đủ Ở Buổi 14 Cuối Khóa — 10/11/2026

**VERDICT: GO (Đạt cả 2 đợt kiểm định độc lập Codex CLI `gpt-6.1-sol` `xhigh`: Đợt 1 `ABSENT_EXEMPT` Vòng 3 `42/42 PASS` & Đợt 2 Quy tắc Buổi 14 vắng vẫn phải nộp đủ Vòng 2 `39/39 PASS + 8/8 F03 focused PASS`)**

---

## 1. Kiểm định Đợt 2 — Vòng 2: Quy tắc Buổi 14 Vắng Mặt Vẫn Bắt Buộc Nộp Đủ (SPCK + Đánh giá cuối khóa)

- **Yêu cầu của Owner:** *"buổi 14 sửa lại, dù vắng mặt nhưng vẫn có thể nộp spck vì đó là buổi cuối cùng của khóa học. Phải nộp đủ ( và trên LMS cũng không khóa )"*
- **Kết luận Reviewer (`gpt-6.1-sol` `xhigh`):** **VERDICT: GO** (`F01: CLOSED; F02: CLOSED; F03: CLOSED`).

### Kết quả các cổng kiểm chứng (Vòng 2)

| Lệnh kiểm tra trong môi trường cô lập TEMP | Kết quả |
|---|---|
| `npx tsc --noEmit --incremental false` | **PASS**, `exit 0`, không lỗi TypeScript |
| `npx tsx scripts/test-streamline-v340-s6.ts` | **PASS**, `exit 0`, `4/4` nhóm `S6-T1..T4` |
| `npx tsx docs/audits/v340/s14-absent-owner-check/probe.mjs` | **PASS**, `exit 0`, **`39/39 PASS, 0 FAIL, 0 ERROR`** |
| `npx tsx f03-focused.mjs` | **PASS**, `exit 0`, **`8/8 PASS`** (ca bổ sung F03) |

### Xác minh đóng các phát hiện Vòng 1 của Quy tắc Buổi 14 (`F01`–`F03`)

1. **`F01` — CLOSED (`src/components/final-project/SubmitBar.tsx:221–257`):**
   - Ở **Buổi 14**, cả điều kiện hiển thị nút `"📈 Cập nhật tiến độ Teaching lên 100%"` (`teachingSuggestion.shouldShow`) lẫn hàm xử lý `handleQuickUpdateTeachingProgress` đều bắt buộc toàn bộ học viên đang học (`isActive = 1`, bao gồm cả học viên vắng mặt ở Buổi 14) phải đạt `VERIFIED` cho **cả Sản phẩm cuối khóa (SPCK) lẫn Đánh giá tổng kết cuối khóa (`spck_session14_evaluations`)** (`session14EvalReadyForHandoff`).
   - Probe trình duyệt (`SUBMITBAR-14-eval-missing-blocks-Teaching100`, `PAGE-14-missing-absent-eval-blocks-Teaching100`, `SUBMITBAR-14-complete-unlocks-both`) xác nhận: nếu học viên vắng Buổi 14 còn thiếu SPCK hoặc thiếu Đánh giá cuối khóa thì nút Teaching 100% và nút Mở Phiếu điểm đều bị khóa; khi đủ cả hai thì mở khóa đồng thời.
2. **`F02` — CLOSED (`src/lib/dashboard/today-tasks.ts:566–578, 667–679, 743–759`):**
   - Thẻ công việc trên Trang chủ tính trạng thái hoàn thành từ bằng chứng `VERIFIED` thực tế trong SQLite của toàn bộ học viên active (`isActive = 1`). Trạng thái lớp `Finished` trong `running_classes.json` (trong cửa sổ ân hạn 7 ngày) không tự ép các bước Buổi 14 thành hoàn tất khi học viên active (kể cả học viên vắng Buổi 14) chưa nộp đủ SPCK hoặc Đánh giá.
   - Probe `DASH-14-finished-still-requires-all-active` đạt `PASS`.
3. **`F03` — CLOSED (`src/lib/db/sqlite.ts:3727–3825` — `clearAbsentStudentSessionFailure`):**
   - Khi tự động dọn lỗi vắng mặt của Buổi 12 hoặc Buổi 13, nếu học viên đó vẫn còn một buổi không được miễn (như Buổi 14 hoặc buổi 12/13 có mặt) đang ở trạng thái `FAILED`, hàm `clearAbsentStudentSessionFailure` giữ nguyên `spck_uploads.status = 'FAILED'`, `errorMessage` và `approvedSessionNumber` của buổi đang lỗi.
   - Đạt cả `DB-cleanup-13-preserves-shared-14-failure` và `8/8` ca kiểm tra chéo bổ sung (`12 <-> 14`, `13 <-> 14`, `12 <-> 13` có mặt).

---

## 2. Kiểm định Đợt 1 — Vòng 3: Cơ chế `ABSENT_EXEMPT` Cho Buổi 12 & Buổi 13

- **Kết luận Reviewer (`gpt-6.1-sol` `xhigh`):** **VERDICT: GO** (`F01: CLOSED; F02: CLOSED; F03: CLOSED; F04: CLOSED; F05: CLOSED`).
- **4/4 cổng bắt buộc PASS** (`exit 0`): TypeScript (`0 errors`), `scripts/test-streamline-v340-s6.ts` (`4/4 PASS`), probe độc lập Vòng 1 **`31/31 PASS`** và probe bổ sung Vòng 2 **`11/11 PASS`** (tổng **`42/42 PASS, 0 FAIL, 0 ERROR`**).

---

## 3. Bảo toàn Dữ liệu Thật (SHA-256)

Hai tệp dữ liệu thật tại dự án gốc giữ nguyên tuyệt đối SHA-256 trước và sau toàn bộ quá trình kiểm thử:

| Tệp dữ liệu thật | SHA-256 trước = sau | Trạng thái |
|---|---|---|
| `data/mindx_bot.db` | `3f996294025a94b7dd19fc4db8368babd7d24f437b49bfc834e0ef901ee1416c` | Bảo toàn 100% |
| `data/running_classes.json` | `171f75d944fb37c604d6c6ee31bc53b23786d5240f03c20e4252b22260c8c2b4` | Bảo toàn 100% |
