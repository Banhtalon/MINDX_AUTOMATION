# BÁO CÁO KIỂM ĐỊNH ĐỘC LẬP `Gemini 4 Neon (XHigh)` — MindX Bot `v3.6.8`

- **Ngày kiểm định:** `2026-11-20`
- **Phiên bản:** `v3.6.8` (Nhận xét Thẳng thắn Mẫu 1 với gạch `+ ` liệt kê đủ 100% lỗi & Huy hiệu `🏅 Top 3` Cách A2)
- **Auditor độc lập:** `Gemini 4 Neon (XHigh)` (`neon-xhigh-auditor`)
- **Kết luận cuối cùng (Round 3):** **`VERDICT: GO`** (`6/6` phát hiện `V368-F01`–`V368-F06` ĐÃ ĐÓNG, `0` lỗi P0/P1/P2 mở)

---

## 1. Tiến trình Kiểm định qua 3 Vòng

1. **Round 1 (`NO-GO` — 0 P0 | 4 P1 | 2 P2):**
   - `V368-F01` (P1): Rò rỉ mã ẩn danh `STUDENT_01` / `STUDENT_PEER` ra nhận xét cuối cùng khi chốt chặn `normalizeCandidImprovementsWithPlusBullets` chèn lỗi bị AI bỏ sót.
   - `V368-F02` (P1): Chèn thừa dòng lỗi ảo `+ **Mất tập trung**` trên luồng `/classroom-manager` → `/session-comments` khi học viên chỉ có `Nói chuyện` / `Việc riêng` / `Rời chỗ` (`khong_chu_y = 0`).
   - `V368-F03` (P1): Lệch số Huy hiệu giữa Bảng Buổi học và `computeCourseAccumulationSummary` khi `courseTotalStars` là tiêu chí phá hòa.
   - `V368-F04` (P1): `commitRosterMutation` trên client đánh dấu dirty cả học sinh anh em bị đổi huy hiệu tự động, làm tăng `rowVer` khi gửi `/api/classroom-manager/save`.
   - `V368-F05` (P2): Dương tính giả trên ghi chú tích cực (`trò chơi game`, câu phủ định `không nói chuyện riêng, không còn lúng túng`, dòng `+ ` dưới `Ghi chú riêng:`).
   - `V368-F06` (P2): Tách inline `+ ` viết chữ thường & lỗi diễn giải `$&` khi thay thế dòng `[Giờ học B14]`.
2. **Round 2 (`NO-GO` — đóng 5/6 `V368-F02`–`V368-F06`, còn tồn dư `V368-F01`):**
   - Phát hiện trong kịch bản **multi-student batch**, `scrubStudentNames` đổi tên bạn cùng lớp thành `STUDENT_02` nên `deanonymizeIssueText` cần thay cả `\bSTUDENT_(?:\d+|PEER)\b` → `"bạn cùng lớp"` và viết hoa đầu dòng.
3. **Round 3 (`VERDICT: GO` — đóng trọn 6/6, 0 lỗi mở):**
   - Xác minh `R3-F01-BATCH` trong `$env:TEMP` (đã dọn sạch): 0 rò rỉ PII lên Gemini, 0 rò rỉ `STUDENT_XX`/`STUDENT_PEER` trong `improvements` & `formattedFullComment`.

## 2. Cổng Kiểm thử & Toàn vẹn Dữ liệu

- **TypeScript:** `node .\node_modules\typescript\bin\tsc --noEmit --incremental false` → **PASS (`exit 0`)**
- **Kiểm thử tự động sau bản vá cuối:**
  - `scripts/test-classroom-and-candid-comments-v368.ts` (`[V368-01..V368-04]` trên Live Chromium `:3098`) → **PASS**
  - `scripts/test-classroom-manager-v367.ts` (`[CM-01..CM-05]` trên Live Chromium `:3097`) → **PASS**
  - `scripts/test-quick-tags-v300.ts` → **PASS**
  - `scripts/test-phase4-codex-repros.ts` (`Round 1 -> Round 17`) → **PASS**
  - `scripts/test-save-comments-timeout-v348.ts` (`9/9 SCT-01..SCT-08B`) → **PASS**
  - `graphify update .` offline `--code-only` → `2.294` nodes, `8.360` edges, `88` communities
- **Vệ sinh Git & Cô lập E2E:** `git diff tsconfig.json next-env.d.ts` rỗng, không còn `.next/e2e-*`, `SECRET_LEAKS=0`.
- **Bảo toàn `100%` SHA-256 trên cả `4/4` tệp dữ liệu thật:**
  - `data/mindx_bot.db`: `1A9E951A11CCB94DE1DD60DC78A75FE53096EE2F3E39BFD83D85BDCBA7334A8C`
  - `data/mindx_bot.db-wal`: `5CBD7CC14A2C102C12F9C775CDC004559B933897210044BDFDA97A1FBB957D7D`
  - `data/running_classes.json`: `02640B3764A888C75959005EB6439E4DD65149A538097BEA943FCD802B0C42B4`
  - `data/config/lms_class_ids.json`: `0C90FA3EBF2B56746D07807202A8AD1EFA2B68818182D740B2DFB2D21E6A9D2A`
