# INDEPENDENT AUDIT REPORT — MINDX BOT v3.8.11 (`Gemini 4 Neon (XHigh)`)

- **Ngày kiểm định:** `2026-11-25`
- **Phiên bản:** `MindX Bot v3.8.11`
- **Phạm vi:**
  1. **Cách 1B (`/admin-center`):** Ô `BTVN` (`homework`) trên LMS là optional cho mọi lớp Coding & Robotics (chỉ kiểm tra ô Tổng kết buổi `summary`/`note`), đồng bộ nhãn UI & Zalo (`Thiếu tổng kết buổi N`, không nhắc `"BTVN"`).
  2. **Cách 2A + M1 (Dòng lớp LEGO `KIND-ROB4/6`, `ROB4/6`, `LEGO`, `KIRO`, `RBT 4+/6+`):**
     - Tách sạch lớp LEGO khỏi VEX (`PRE*`, `ARM*`, `SEMI*`, `ROB04`, `ROB01`, `ROB40..69`).
     - Tab 1 Checkpoint (`M1`): Buổi 5 & Buổi 9, không có điểm LT/TH số — kiểm tra đủ 7 ô sao `[ĐNL]` (`RATE`) cho học viên đi học và giữ quy tắc phân biệt học viên nghỉ chờ học bù (`v3.8.10`).
     - Tab 3 SPCK (`2A`): Miễn Buổi 12; gộp Buổi 13–14 thành 1 cụm (`B13–14`) chỉ yêu cầu `>= 1` ảnh sản phẩm (`0` file code); kiểm tra 7 ô `RATE` + Demo `1.0 × 5` + Thư 3 phần tại Buổi 14.
     - Tab 4 (`> B9` Teaching Tasks): Miễn hoàn toàn cho lớp LEGO (`eligibleGt9: false`, `taskStatus: "NOT_ELIGIBLE"`).
     - `/final-project` & Ghi LMS: Rubik `5 × 1.0 = 5.0` (nhãn `"Kỹ năng sử dụng công nghệ"`), dồn điểm lossless 4 chữ số thập phân từ bảng `ROB.xlsx`, 7 ID `[ĐNL]` (35 radio DOM / 7 `RATE` API), điều kiện nộp ảnh-only & chặn thư mục chỉ có logo mặc định.
- **Reviewer độc lập:** `neon-v3811-auditor` (`model: gemini-4-neon-xhigh`)

---

## 1. Diễn biến Kiểm định

| Vòng | Kết luận | Tóm tắt |
| :--- | :--- | :--- |
| **Round 1** (Board `#20`) | **NO-GO** | Phát hiện 10 lỗi (`F01..F10`: `7 P1`, `2 P2`, `1 P3`) qua đọc mã nguồn & 10 probe đối kháng trong `os.tmpdir()`. |
| **Round 2** (Board `#22`) | **VERDICT: GO** | Xác nhận đóng 10/10 phát hiện (`0 P0`, `0 P1`, `0 P2`; 1 ghi chú `P3` không chặn ở nhánh mock non-live LMS). |

---

## 2. Chi tiết Đóng 10 Phát hiện (`F01–F10`)

1. **`F01 [P1] — CLOSED`:** `src/lib/playwright/session14-eval-uploader.ts` (`L1784`, `L1185`) chuyển vòng Read-after-Write DOM sang `activeCompKeys` (7 nhóm LEGO / 35 radio, 9 nhóm Coding/VEX) và truyền `classId` vào `formatRoboticsAwardRankingHtmlForLms`. Đã xác minh trên modal 35 radio & kiểm thử tamper nhóm `#7` (`verifiedCount=0, failedCount=1`).
2. **`F02 [P1] — CLOSED`:** `src/lib/admin-center/admin-teaching-actions.ts` (`L687`, `L1131`, `L1327`) & `src/lib/admin-center/admin-lms-scanner.ts` (`L515`) chặn và miễn hoàn toàn lớp LEGO ở Tab 4 (`NOT_ELIGIBLE`, `validateSpckTaskEligibility` HTTP 400, batch AUTO `totalTargets=0`).
3. **`F03 [P1] — CLOSED`:** `src/lib/lms/lms-write-client.ts` (`L2221`, `L2609`, `L2651`) bổ sung fallback `classDoc?.course?.courseProcess` và khóa ID `67b54307f79c7bc326e017ff` + `/đánh giá chung/i` chỉ khớp khi `isLego`, cô lập an toàn vùng `CONTENT` lớp Coding (`VT-CSI88`).
4. **`F04 [P1] — CLOSED`:** `src/lib/db/sqlite.ts` (`L5532-5590`) bổ sung `classId` vào `formatRoboticsAwardRankingHtmlForLms`, dùng thang `5×1.0` & nhãn `"Kỹ năng sử dụng công nghệ (1/1)"` cho LEGO.
5. **`F05 [P1] — CLOSED`:** `src/lib/db/sqlite.ts` (`L4966`) & `src/lib/spck/spck-ui-helpers.ts` (`L108`) siết regex biên token `(?=$|[-_\s])` — tách sạch `ROB40..49` / `ROB60..69` / `ROB04` / `PRE` / `ARM` / `SEMI` (`false`) khỏi dòng LEGO (`true`).
6. **`F06 [P1] — CLOSED`:** `src/lib/admin-center/admin-lms-scanner.ts` (`L1300`) giữ sàn `minLegoCpRates = maxSlotRateCount >= 6 ? Math.min(7, maxSlotRateCount) : 7`, ngăn lọt xanh giả khi giáo viên mới tích `1/7..5/7` sao.
7. **`F07 [P1] — CLOSED`:** `src/app/final-project/page.tsx` (`L2286`) truyền `selectedClassId` (+ deps `useMemo`) vào `getRowReadinessSummary`; `src/app/api/spck/approve/route.ts` (`L482`) chặn phía server thư mục LEGO chỉ có logo mặc định và 0 ảnh/file/link (`HTTP 400`).
8. **`F08 [P2] — CLOSED`:** `src/lib/db/sqlite.ts` (`L5128`, `rebalanceRawDemoScoresForClass4dp`), `src/lib/spck/spck-ui-helpers.ts` (`L53`), `src/components/final-project/StudentRow.tsx` (`L1496`), `src/lib/local-files/spck-demo-score-reader.ts` (`L375`, `L1063`, `L1291`) tính TB ĐNL theo đúng 7 tiêu chí LEGO (`5.0` khi `7/7` mức `5`), giữ nguyên 4 chữ số thập phân tổng `4.375` khi dồn từ bảng `ROB.xlsx`, và hiển thị đúng 7 ô `[ĐNL]` trên UI.
9. **`F09 [P2] — CLOSED`:** `src/lib/playwright/scrape-scores.ts` (`L1999`) phân nhánh `isRobotics && !isLegoRobotics ? 3 : 4` (CP1 B5 / CP2 B9 cho LEGO), không rò ghi chú vắng B4 sang B5 CP1.
10. **`F10 [P3] — CLOSED`:** `src/lib/admin-center/admin-zalo-reminder.ts` (`L56`) xuất `(B13–14)` cho LEGO và `(B12–14)` cho VEX/Coding.

*(Ghi chú `P3` không chặn ở nhánh mock non-live LMS: `session14-eval-uploader.ts:180` `verifyServerEvaluationPayload` đối chiếu `srvAward` theo `record.awardRanking` trong chế độ test giả lập; nhánh `isLiveLms=true` kiểm tra DOM theo `resolvedQuill4Text`.)*

---

## 3. Xác minh Build, Kiểm thử, Bảo mật & Dữ liệu thật

- **TypeScript (`tsc --noEmit --incremental false`):** PASS (`0` lỗi).
- **8 Bộ Kiểm thử hồi quy (`v3.8.11` – `v3.5.0` + CSI + Drive Thumbnails):** ALL PASS (`exit 0`, trong đó `test-admin-center-lego-and-summary-v3811.ts` đạt `6/6` và Reviewer chạy 5 bộ cốt lõi + **10/10 Round-2 Adversarial Probes** cô lập trong `os.tmpdir()` đạt 100%, đã dọn sạch `TEMP`).
- **Bảo mật Client (`'use client'`):** CLEAN (`0` rò biến môi trường bí mật).
- **SHA-256 dữ liệu thật (`100%` nguyên vẹn):**
  - `data/mindx_bot.db`: `6AB90EA905AE2F7C901485E039579AA8E6429509DD322E4044793D4EDA49C158`
  - `data/running_classes.json`: `DCDFC9195A37972362E2717FF6093B19582890D41311A6C5DB3ECC7FC57E1012`
  - `data/config/lms_class_ids.json`: `16D635C5C58C3A1FE79885FA3F4582AC10356BE27F75FC2C23688E4CA2DBC16F`
