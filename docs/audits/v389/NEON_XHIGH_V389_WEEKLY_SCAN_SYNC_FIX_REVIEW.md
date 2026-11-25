# BÁO CÁO KIỂM ĐỊNH ĐỘC LẬP — BẢN VÁ ĐỒNG BỘ `QUÉT CÔNG VIỆC TUẦN NÀY` (`v3.8.9+` ĐỢT 2)

- **Người kiểm định:** `neon-reviewer-2` (`Gemini 4 Neon (XHigh)`)
- **Thời điểm:** `25/11/2026` — **Round 2 (Final)**
- **Phạm vi rà soát (`git diff`):**
  - `src/lib/playwright/sync-class.ts` (`syncLmsSlotCompletionToSqlite`)
  - `src/lib/db/sqlite.ts` (`session14EvalRepo.saveDraft`)
  - `src/lib/report-card/report-card-staleness.ts` (`computeReportCardStaleness`)
  - `scripts/test-streamline-v340-s4.ts` (`S4-R3-01..03` + `F03`)
  - `scripts/test-checkpoint-auto-v370.ts` (`V370-09 (7)` + `F01`, `F02a`, `F02b`)
- **Kết luận cuối cùng (Round 2):** **`VERDICT: GO`** — Đóng trọn **`4/4`** phát hiện Round 1 (`F01 [P1]`, `F02 [P2]`, `F03 [P3]`, `F04 [P3]` đều **`CLOSED`**), **`0`** lỗi P0/P1/P2/P3 mở, **`9/9`** cổng kiểm thử bắt buộc PASS (`exit 0`), **`18/18`** probe đối kháng & bản sao DB thật PASS (`0` thất bại), bảo toàn **`100%`** SHA-256 dữ liệu thật trong `data/`.

---

## 1. Kết quả kiểm định Round 2 (Xác minh đóng `4/4` phát hiện)

| Mã | Mức độ | Trạng thái Round 2 | Xác minh mã nguồn & thực nghiệm Round 2 |
|---|---|---|---|
| **F01** | `P1` | **CLOSED** | `src/lib/playwright/sync-class.ts:2018-2056`: Đã khóa nhánh `preferLmsVerified` (và nhánh `finalText` rỗng) bằng `preferLmsBlockedByCompetency` (`existingCp?.competencyScores && !lmsCompetencyMatchesNext`) và `preferLmsBlockedByStaleHeaderText` (`hasLocalCheckpointHeader && normRefreshedPlain.length > 0 && normRefreshedPlain !== normLmsForCp`). Probe `R2_P4_F01_STALE_TEXT_STAY_DRAFT` & `R2_P4_F01_BAD_RATE_STAY_DRAFT` + `V370-09 (7)` PASS 100% (cả 2 học sinh lỗi giữ nguyên `DRAFT` sau lượt quét `preferLmsVerified: true` thứ 2; `ST_SYNC_HIST` pre-v3.7.0 không có `competencyScores`/header vẫn bảo toàn `VERIFIED` qua `R2_P2_HIST_PASS1..3`). |
| **F02** | `P2` | **CLOSED** | `src/lib/playwright/sync-class.ts:2058-2080`: Đã tính `isOrphanedSaving`, `lmsCommentIsPlaceholder`, `canMarkVerified` và `willWriteVerified = lmsComment.length > 0 && !lmsCommentIsPlaceholder && canMarkVerified` **trước** khi tính `nextApprovedSnapshotHash` & đóng gói `mergedCheckpointDataJson`. Probe `R2_P3_F02A_RECOVER_DRAFT_HASH` + `V370-09 (7) F02a` PASS (bản ghi bị lỗi cũ hạ về `DRAFT` với `approvedSnapshotHash = null` tự phục hồi **cả `VERIFIED` lẫn `approvedSnapshotHash`** ngay trong 1 lượt quét); `R2_P5_F02B_PLACEHOLDER_HASH_NULL` + `F02b` PASS (placeholder `"."` giữ nguyên `approvedSnapshotHash = null`); `R2_LIVE_NNM_HEAL_HASH` PASS trên bản sao DB thật. |
| **F03** | `P3` | **CLOSED** | `src/lib/playwright/sync-class.ts:2281-2306`: Dùng `isSameVerifiedContent` cập nhật đồng thời `contentHash = evalHash` và `updatedAt = CASE WHEN ? = 1 THEN verifiedAt ELSE updatedAt END` ngay trong 1 lượt quét duy nhất. Probe `R2_P6_F03_SINGLE_PASS_HEAL` + `S4-R3 F03` PASS 100%. |
| **F04** | `P3` | **CLOSED** | `src/lib/playwright/sync-class.ts:1977-1997`: Đã đưa `isOrphanedSaving` lên trước và ràng buộc `(existingFb.status === "SAVING" && isOrphanedSaving)` trong `lmsAlreadyMatchesRefreshedCheckpoint`. Probe `R2_P7_F04_ORPHAN_SAVING_HEALS` (mồ côi tự phục hồi `VERIFIED` + `approvedSnapshotHash`) & `R2_P7_F04_ACTIVE_SAVING_PRESERVED` (`SAVE_COMMENTS` đang chạy trong `taskQueue` giữ nguyên `SAVING`) đều PASS 100%. |

---

## 2. Kết quả cổng kiểm thử bắt buộc Round 2 (`9/9` PASS `exit 0`)

| # | Cổng kiểm thử | Kết quả Round 2 | Phạm vi đã xác minh |
|---|---|---|---|
| 1 | `node .\node_modules\typescript\bin\tsc --noEmit --incremental false` | **PASS (`exit 0`)** | 0 lỗi kiểu TypeScript |
| 2 | `npx.cmd tsx scripts/test-streamline-v340-s4.ts` | **PASS (`exit 0`)** | `S4-T1..S4-T5`, `S4-01..S4-03`, `S4-R2-01..03`, `S4-R3-01..03` + `F03` |
| 3 | `npx.cmd tsx scripts/test-checkpoint-auto-v370.ts` | **PASS (`exit 0`)** | `V370-01..V370-09`, `V370-09 (7)` (`F01`, `F02a`, `F02b`) & Live Chromium `:3099` |
| 4 | `npx.cmd tsx scripts/test-checkpoint-csa04-v386.ts` | **PASS (`exit 0`)** | `V386-01..V386-07` & Live Chromium `:3095` |
| 5 | `npx.cmd tsx scripts/test-save-comments-timeout-v348.ts` | **PASS (`exit 0`)** | `SCT-01..SCT-08B` (gồm `SCT-07` bảo toàn `DRAFT` đang sửa tay) |
| 6 | `npx.cmd tsx scripts/test-stuck-saving-recovery-v369.ts` | **PASS (`exit 0`)** | `SSR-01..SSR-03` |
| 7 | `npx.cmd tsx scripts/test-session14-v290.ts` | **PASS (`exit 0`)** | `S14-01..S14-07` |
| 8 | `npx.cmd tsx scripts/test-report-card-v330.ts` | **PASS (`exit 0`)** | `RC-01..RC-06`, `S2-01..S2-09` |
| 9 | `npx.cmd tsx scripts/test-report-card-batch-sync.ts` | **PASS (`exit 0`)** | `BS-01..BS-09` |

*(Ghi chú hồi quy Round 1: `scripts/test-streamline-v340-s6.ts` đã xác nhận `S6-T1..S6-T3` gồm `S6-T2 Point 3` PASS; riêng `S6-T4` dùng selector UI cũ trước `v3.6.0`, nằm ngoài phạm vi bản vá.)*

---

## 3. Probe đối kháng & bản sao cô lập DB thật Round 2 (`18/18` PASS, `0` FAIL)

Toàn bộ probe chạy cô lập hoàn toàn trong `os.tmpdir()` trên bản sao của `data/mindx_bot.db` (+ `-wal`/`-shm`), `data/running_classes.json`, `data/config/lms_class_ids.json`:

1. **`R2_LIVE_8_CLASSES` (PASS):** `getDashboardTodayTodoCards({ limit: 24 })` trả **`8/8` lớp `allDone: true`** (`VT-JSA15`, `VT-C4K-PTI12`, `VT-ROB-ARMI13`, `VT-CSA04-HB`, `VT-C4K-GI34`, `VT-ROB-SEMIA05`, `VT-C4K-PTA13`, `VT-CSI02`).
2. **`R2_LIVE_HEAL_VT-C4K-PTA13` & `R2_LIVE_HEAL_VT-CSI02` (PASS):** Tự chữa lành `5/5` HV `VT-C4K-PTA13` và `4/4` HV `VT-CSI02` đưa `updatedAt` về đúng `verifiedAt` trong 1 lượt quét.
3. **`R2_LIVE_NNM_HEAL_HASH` (PASS):** `Nguyễn Ngọc Minh` (`VT-ROB-ARMI13_SESS_04`) trên bản sao DB thật tự chữa lành `approvedSnapshotHash = 675a399e...` và giữ nguyên `VERIFIED`.
4. **`R2_P1_ST_P1_*` (4/4 PASS):** `normalizeSyncCompare` chỉ gom khoảng trắng trước `[.,;:!?]` do thẻ HTML `<strong>`; chặn 100% sai khác thật (`Chưa nhập` vs `4.0/5.0`, `3.5/5.0` vs `4.0/5.0`, khác từ khóa).
5. **`R2_P2_HIST_PASS1..3` (3/3 PASS):** Bản ghi lịch sử pre-v3.7.0 không có 9 `RATE` giữ `VERIFIED`, `approvedSnapshotHash = null`, `competencyScores = null` qua 3 lượt quét liên tiếp.
6. **`R2_P3_F02A_RECOVER_DRAFT_HASH` (PASS):** Bản ghi bị lỗi cũ hạ về `DRAFT` (`approvedSnapshotHash = null`, `finalText = 4.0/5.0`) tự phục hồi đồng thời `VERIFIED` + `approvedSnapshotHash` trong đúng 1 lượt `preferLmsVerified: true`.
7. **`R2_P4_F01_STALE_TEXT_STAY_DRAFT` & `R2_P4_F01_BAD_RATE_STAY_DRAFT` (2/2 PASS):** Học sinh còn `3.5/5.0` cũ trên LMS hoặc lệch 9 `RATE` giữ nguyên `DRAFT` sau lượt quét `preferLmsVerified: true` lần 2.
8. **`R2_P5_F02B_PLACEHOLDER_HASH_NULL` (PASS):** Placeholder `"."` không gắn nhầm `approvedSnapshotHash`.
9. **`R2_P6_F03_SINGLE_PASS_HEAL` (PASS):** Buổi 14 Robotics có `awardRankGrade = 1` lệch `contentHash` cũ + `updatedAt > verifiedAt` tự chữa lành cả 2 trong 1 lượt.
10. **`R2_P7_F04_ORPHAN_SAVING_HEALS` & `R2_P7_F04_ACTIVE_SAVING_PRESERVED` (2/2 PASS):** `SAVING` mồ côi tự phục hồi `VERIFIED` + hash; `SAVING` đang có tác vụ `SAVE_COMMENTS` chạy trong `taskQueue` được bảo toàn nguyên vẹn.
11. **`saveDraft` & `computeReportCardStaleness`:** Bảo toàn no-op trên `VERIFIED` (kể cả `awardRankGrade = 0`), hạ `WAITING_APPROVAL` khi sửa thật, phát hiện lệch `finalProduct`/`finalCompetency` trước mốc thời gian và báo stale khi `verifiedAt = NULL`.

---

## 4. Xác nhận bảo toàn `100%` SHA-256 dữ liệu thật trong `data/`

Không có bất kỳ thư mục tạm nào (`neon-*`) còn sót trong `%TEMP%`. Toàn bộ `5/5` tệp dữ liệu thật giữ nguyên SHA-256 xuyên suốt cả Round 1 & Round 2:

| Tệp dữ liệu thật | SHA-256 Trước (Baseline) | SHA-256 Sau Round 2 | Khớp |
|---|---|---|---|
| `data/mindx_bot.db` | `6AB90EA905AE2F7C901485E039579AA8E6429509DD322E4044793D4EDA49C158` | `6AB90EA905AE2F7C901485E039579AA8E6429509DD322E4044793D4EDA49C158` | **100%** |
| `data/mindx_bot.db-wal` | `DCBD62B1EE8925A576EE9F346898B2768B5B33B845F8DC7B58746D8E74B861E8` | `DCBD62B1EE8925A576EE9F346898B2768B5B33B845F8DC7B58746D8E74B861E8` | **100%** |
| `data/mindx_bot.db-shm` | `81854628A6C8B3EDCFE92387FAD418CC894B6BCA977E83AC0246CE166956B1C5` | `81854628A6C8B3EDCFE92387FAD418CC894B6BCA977E83AC0246CE166956B1C5` | **100%** |
| `data/running_classes.json` | `DCDFC9195A37972362E2717FF6093B19582890D41311A6C5DB3ECC7FC57E1012` | `DCDFC9195A37972362E2717FF6093B19582890D41311A6C5DB3ECC7FC57E1012` | **100%** |
| `data/config/lms_class_ids.json` | `16D635C5C58C3A1FE79885FA3F4582AC10356BE27F75FC2C23688E4CA2DBC16F` | `16D635C5C58C3A1FE79885FA3F4582AC10356BE27F75FC2C23688E4CA2DBC16F` | **100%** |

---

## 5. Kết luận cuối cùng

- **VERDICT:** **`GO`**
- **Tổng kết:** Bản vá lỗi đồng bộ `Quét công việc tuần này` (`v3.8.9+` Đợt 2) đã đóng sạch `4/4` phát hiện Round 1 (`F01`–`F04`), đạt `9/9` cổng kiểm thử bắt buộc + `18/18` probe đối kháng & bản sao DB thật (`8/8` lớp `allDone: true`, tự chữa lành `VT-C4K-PTA13`/`VT-CSI02` & `Nguyễn Ngọc Minh`), sẵn sàng cập nhật tài liệu `PROJECT_STATE.md` / `CHANGELOG.md` / `MINDX_AUTOMATION_PLAN.md` và đồng bộ GitHub.
