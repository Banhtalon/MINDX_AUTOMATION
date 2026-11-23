# Báo Cáo Kiểm Định Độc Lập `v3.8.6` — Gemini 4 Neon (XHigh) (Round 3 — Final)

- **Phiên bản kiểm định:** `v3.8.6` (Đồng bộ điểm Checkpoint `#tab-3` cho lớp kiểu mới như `VT-CSA04-HB` + Ưu tiên điểm chấm tay `#tab-10` như Đặng Trọng Khang + Sửa tay nhanh `LT`/`TH` trong modal `⚙️ 9 ô [ĐNL]` + chảy sang Phiếu điểm & BTVN)
- **Reviewer độc lập:** `v386-verifier` (`Gemini 4 Neon (XHigh)`)
- **Ngày kiểm định:** `23/11/2026` (Round 1 → Round 2 → Round 3)
- **Môi trường cô lập:** 100% kiểm thử & probe đối kháng chạy trong `os.tmpdir()`, không chạm máy chủ `:3000`, `./playwright-auth` hay ghi vào `data/`.

---

## VERDICT: GO

**Kết luận nghiệm thu cuối cùng (Round 3):**
- Đóng trọn **`8/8`** phát hiện qua 3 vòng kiểm định (`F01`–`F06` Round 1 + `R2-F01` & `R2-F02` Round 2) — **`0` lỗi P0 / P1 / P2 / P3 mở**.
- Toàn bộ **`6/6`** cổng biên dịch & kiểm thử tự động sau bản vá cuối đều **PASS (`exit 0`)**: `tsc --noEmit --incremental false`, `test-checkpoint-csa04-v386.ts` (`V386-01..V386-07` + Live Chromium `:3095` Light/Dark), `test-checkpoint-auto-v370.ts` (`V370-01..V370-09` + Live Chromium `:3099`), `test-checkpoint-v300.ts` (`CP-01..CP-05`), `test-report-card-v330.ts` (`RC-01..RC-06` + `S2-01..S2-09` `vm.runInContext`) và `test-report-card-batch-sync.ts` (`BS-01..BS-09`).
- Toàn bộ bộ probe đối kháng độc lập Round 1–3 (`PROBE-A1..A6`, `R2-CHECK-F01..F06`, `R3-VERIFY-01A..01E` & `R3-VERIFY-02`) đều **PASS `100%`**.
- An ninh & toàn vẹn dữ liệu đạt chuẩn tuyệt đối: `0` bí mật môi trường rò ra `'use client'`, `src/lib/playwright/save-comments.ts` nguyên vẹn `0 diff` (tuyệt đối không chạm LT/TH/quiz trên LMS), `0` tệp tạm sót (`TMP_V386=0`, `NEXT_E2E=0`), và **`4/4` tệp dữ liệu thật trong `data/` bảo toàn `100%` SHA-256** xuyên suốt cả 3 vòng.

---

## 1. Bảng Theo Dõi Đóng Phát Hiện Qua 3 Vòng (`8/8` CLOSED)

| Mã | Vòng | Mức độ | Tóm tắt phát hiện & cách đóng | Trạng thái |
|---|---|---|---|---|
| `F01` | R1 | P1 | `ClassSyncer` ghi đè `practiceScore: null → 0` & hạ oan `APPROVED → DRAFT` trên Khoa chờ chấm `#tab-3`; giữ kẹt `hasUngradedPractice: true` sau khi chấm `4.0` → Đã vá `sync-class.ts`, `parseCheckpointDataJson`, `mergeCheckpointStudentData`. | **CLOSED (R2)** |
| `F02` | R1 | P1 | Fallback nguồn 2 trong `extractCheckpointSubmissionScoresForClass` đọc ngược `class_report_cards.stageScores` gây vòng lặp hồi sinh điểm cũ `4.0`/`4.5` ở lớp Coding không có cột CP → Đã gỡ bỏ hoàn toàn fallback vòng ngược, chỉ đọc `#tab-3` thô từ `score_matrix_cache`. | **CLOSED (R2)** |
| `F03` | R1 | P1 | `POST /api/session-comments/approve` trả `409 CHECKPOINT_DATA_DRIFT` sau khi `#tab-3` cập nhật `score_matrix_cache` & merge qua `list` (`persist: false`) → Đã bổ sung `allowServerReconciledCheckpoint` trong `approve/route.ts` & `sqlite.ts` `approveConditional` (giữ nguyên CAS `ROW_VERSION_CONFLICT`, `FINAL_TEXT_DRIFT`, `CHECKPOINT_DATA_DRIFT` khi giả mạo) + tự làm mới dòng điểm trên UI bản nháp. | **CLOSED (R2)** |
| `F04` | R1 | P2 | Điểm `LT`/`TH` sửa tay trong modal chưa chảy ngay sang `GET /api/report-card` & `staleness` → Đã thêm `overlayManualCheckpointFeedbacksOntoSnapshot`, `syncCheckpointScoresIntoExistingReportCard` và `hasNewerManualCheckpoint`. | **CLOSED (R2/R3)** |
| `F05` | R1 | P2 | `handleCommitManualCpScore` & `handleResetManualCpScore` chưa flush bản nháp debounce trước `loadClassData` và nuốt lỗi `checkpoint-sync` → Đã bổ sung `await flushAllPendingDraftSaves()`, kiểm tra scope lớp/buổi và hiển thị lỗi `checkpoint-sync` rõ ràng. | **CLOSED (R2)** |
| `F06` | R1 | P3 | `scrape-scores.ts` CRLF diff, thiếu guard `boolean` tường minh trong `approve/route.ts`, `extraWarn` ẩn `scoreScrapeWarning`, thiếu `\bcp\s*0?[12]\b` trong `scrape-scores.ts` → Đã chuẩn hóa LF (`hasCR: false`) và đóng đủ 4 mục. | **CLOSED (R2)** |
| `R2-F01` | R2 | P1 | `checkpoint-sync` gọi `syncCheckpointScoresIntoExistingReportCard` trên cả lớp bằng điểm 1dp (xóa điểm `ST_A` `4.0/4.5 → null`, làm tròn lệch `ST_B` `3.75 → 3.8`) và `save-draft` kích hoạt sync ngay cả khi chỉ bấm `[ĐNL]` → Đã gỡ vòng lặp sync cả lớp khỏi `checkpoint-sync/route.ts`; trong `save-draft/route.ts` chỉ đồng bộ đích danh trường có `userEdited*` bật/tắt hoặc đổi giá trị so với `prevCpBeforeSave`; bổ sung `resolveRestoredLmsCheckpointScores2dp` + `round2` trong `sqlite.ts` giữ chuẩn 2dp `3.75` và `null` chờ chấm khi bấm `↺ LMS`. | **CLOSED (R3)** |
| `R2-F02` | R2 | P2 | `slotPracticeScore === undefined` trong `sync-class.ts` áp lên cả nhánh `practiceScore > 0` làm kẹt hạ điểm `#tab-10` `4.0 → 0.0` ở bản ghi Coding cũ trước `v3.8.6` → Đã tách riêng `slotPracticeScore === undefined` chỉ áp cho nhánh chờ chấm `hasUngradedPractice && practiceScore === null`. | **CLOSED (R3)** |

---

## 2. Kết Quả Cổng Kiểm Thử & Probe Đối Kháng Round 3

### 2.1. Cổng biên dịch & các bộ kiểm thử tự động (sau bản vá cuối)

| STT | Lệnh kiểm thử | Kết quả | Phạm vi xác nhận |
|---:|---|---|---|
| 1 | `node .\node_modules\typescript\bin\tsc --noEmit --incremental false` | **PASS** (`exit 0`) | 0 lỗi TypeScript toàn dự án |
| 2 | `npx.cmd tsx scripts/test-checkpoint-csa04-v386.ts` | **PASS** (`exit 0`) | `V386-01..V386-07` + Live Chromium `:3095` Light/Dark (`F01..F06`, `R2-F01`, `R2-F02`) |
| 3 | `npx.cmd tsx scripts/test-checkpoint-auto-v370.ts` | **PASS** (`exit 0`) | `V370-01..V370-09` + Live Chromium `:3099` |
| 4 | `npx.cmd tsx scripts/test-checkpoint-v300.ts` | **PASS** (`exit 0`) | `CP-01..CP-05` |
| 5 | `npx.cmd tsx scripts/test-report-card-v330.ts` | **PASS** (`exit 0`) | `RC-01..RC-06` + `S2-01..S2-09` `vm.runInContext` |
| 6 | `npx.cmd tsx scripts/test-report-card-batch-sync.ts` | **PASS** (`exit 0`) | `BS-01..BS-09` |

### 2.2. Bộ probe đối kháng độc lập trong `os.tmpdir()` (Round 1–3)

| Mã Probe | Mục tiêu kiểm chứng | Kết quả |
|---|---|---|
| `PROBE-A1` | `scaleSubmissionScoreTo5(10,100)===0.5`, biên `0/100`, chuỗi dấu phẩy, từ chối âm/`boolean`/`NaN`/`Infinity`/rỗng/object | **PASS** |
| `PROBE-A2` | Thứ tự ưu tiên `reconcileCheckpointTestScores` (UI `userEdited*` > `#tab-10 > 0` > `#tab-3 > 0` > `hasUngradedPractice` > `0` > `null`) | **PASS** |
| `PROBE-A3` | Chạy `src/lib/playwright/scrape-scores.ts` trong sandbox `vm.runInContext` không import | **PASS** |
| `PROBE-A4` | Sửa tay chỉ `LT`/`TH` không ghi đè `userEditedCompetency` (cả `false` lẫn `true`) & bảo toàn 9 `[ĐNL]` tùy chỉnh | **PASS** |
| `PROBE-A5` | `.space-y-2` trong `checkpoint-dnl-modal` chỉ nằm duy nhất ở danh sách 9 tiêu chí | **PASS** |
| `PROBE-A6` | An ninh: `CLIENT_SECRET_HITS=0`, `SAVE_COMMENTS_DIFF=0`, `validateLocalRequest` `403`, API validation `400` | **PASS** |
| `R2-CHECK-F01..F03` | Xác nhận đóng trọn `F01A`, `F01B`, `F02`, `F03` (`200` hợp lệ + `409` giả mạo điểm/nội dung/`rowVer`) | **PASS** |
| `R3-VERIFY-01A/B` | `checkpoint-sync(syncFromLms: false)` bảo toàn `ST_A` `4.0/4.5`, `ST_B` `3.75` (2dp) & giữ `APPROVED` trên Phiếu điểm | **PASS** |
| `R3-VERIFY-01C` | Bấm ô `[ĐNL]` qua `save-draft` (kèm `practiceScore: 3.8` 1dp) không đụng `class_report_cards` (`3.75` & `APPROVED` nguyên vẹn) | **PASS** |
| `R3-VERIFY-01D` | Sửa tay `TH = 4.2` chỉ cập nhật đúng `ST_B.cp1Practice = 4.2` (hạ `APPROVED → WAITING_APPROVAL`); bấm `↺ LMS` khôi phục đúng `3.75` (2dp) cho `ST_B` và `null` (chờ chấm `#tab-3`, không thành `0`) cho `ST_KHOA` | **PASS** |
| `R3-VERIFY-01E` | Robotics (`VT-ROB-ARMI13`) sửa tay `4.5` rồi bấm `↺ LMS` khôi phục đúng `slotPracticeScore = 3.5` | **PASS** |
| `R3-VERIFY-02` | Bản ghi Coding cũ (`slotPracticeScore === undefined`, `practiceScore: 4.0`) hạ `#tab-10` `4.0 → 0.0` cập nhật về `0.0`, đổi tiêu đề `finalText` & hạ `APPROVED → DRAFT` | **PASS** |

---

## 3. Xác Minh Bảo Toàn Dữ Liệu Thật (`data/` SHA-256) & Vệ Sinh Môi Trường

- `CLIENT_SECRET_HITS = 0`
- `SAVE_COMMENTS_DIFF = 0` (tuyệt đối không chạm logic đẩy LMS)
- `NEXT_E2E = 0` và `TMP_V386 = 0` (sạch 100% thư mục tạm)

| Tệp dữ liệu thật | Kích thước (bytes) | SHA-256 Baseline Round 1 | SHA-256 Final Round 3 | Đối chiếu |
|---|---:|---|---|---|
| `data/mindx_bot.db` | `8470528` | `9DCB62242C955E724FD3AE984D3182DE6FD3BDA805B1AE475B87AD22C44C2EDC` | `9DCB62242C955E724FD3AE984D3182DE6FD3BDA805B1AE475B87AD22C44C2EDC` | **MATCH 100%** |
| `data/mindx_bot.db-wal` | `4330152` | `809900A7E8DF4FF116FF36D9D700F47E2B5A54B5C07CC66DD1C55E3779966A97` | `809900A7E8DF4FF116FF36D9D700F47E2B5A54B5C07CC66DD1C55E3779966A97` | **MATCH 100%** |
| `data/running_classes.json` | `2397` | `FCBA555CBC9F75871AE6187F597E3884F3556EC2E3B77529E143D32C73D4BA40` | `FCBA555CBC9F75871AE6187F597E3884F3556EC2E3B77529E143D32C73D4BA40` | **MATCH 100%** |
| `data/config/lms_class_ids.json` | `902` | `AC93C6A821E9D6FA8B148E82EC1D56B5FFEB627EE300935DE97AE3A62F7FA188` | `AC93C6A821E9D6FA8B148E82EC1D56B5FFEB627EE300935DE97AE3A62F7FA188` | **MATCH 100%** |
