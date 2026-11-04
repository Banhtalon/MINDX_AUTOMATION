# LƯU TRỮ LỊCH SỬ KIỂM ĐỊNH ĐỘC LẬP (AUDIT HISTORY ARCHIVE)

> **Mục đích:** Tệp này lưu trữ toàn bộ lịch sử các vòng kiểm định độc lập (Audit Rounds `v2.8.0` $\rightarrow$ `v3.4.0`) được tách ra từ `PROJECT_STATE.md`, `MINDX_AUTOMATION_PLAN.md` và `CHANGELOG.md` để giúp `PROJECT_STATE.md` luôn gọn nhẹ, giúp AI Agent đọc trọn vẹn toàn bộ kiến trúc và bản đồ file chỉ trong **1 lượt đọc duy nhất**.
>
> **Trạng thái nghiệm thu mới nhất:** Xem trực tiếp tại đầu tệp [PROJECT_STATE.md](../../PROJECT_STATE.md).

---

## 1. LỊCH SỬ KIỂM ĐỊNH GIAI ĐOẠN 10 (`v3.4.0` — Chặng `S0` $\rightarrow$ `S8`)

- **S8 Round 4 (30/10/2026): VERDICT: GO.** `S8-01: CLOSED; S8-02: CLOSED; S8-R2-01: CLOSED; S8-R3-01: CLOSED; S8-R3-02: CLOSED` — toàn bộ 5/5 phát hiện đã đóng. Probe ảnh hợp lệ/junction **14/14 PASS** (7/7 có ảnh hợp lệ, 7/7 chặn junction); tài nguyên **5/5 PASS**, path **403**, browser **0 context phụ**, edge **20/20 PASS**; TypeScript và ba suite SPCK/S5/S7 đều PASS, **10/10 lệnh exit 0**. Hai tệp dữ liệu thật bảo toàn 100% SHA-256; 2.951/2.951 tệp bất biến giữ nguyên. Báo cáo: [CODEX_V340_FINAL_ROUND4.md](v340/CODEX_V340_FINAL_ROUND4.md); bằng chứng: `docs/audits/v340/s8-round4/`.
- **Lịch sử S8 Round 3 (30/10/2026): VERDICT: NO-GO.** `S8-01: CLOSED; S8-02: CLOSED; S8-R2-01: CLOSED` (3/3 phát hiện cũ). Probe tài nguyên gốc **5/5 PASS**, path **403**, browser **0 context phụ**, edge **20/20 PASS**; TypeScript và ba suite SPCK/S5/S7 đều PASS. Probe ảnh hợp lệ/junction **11/14 PASS, 3 FAIL**: mất ảnh hợp lệ trong `style="..."` và CSS liên kết (`S8-R3-01`, `S8-R3-02` — MEDIUM OPEN tại thời điểm Round 3). Báo cáo: [CODEX_V340_FINAL_ROUND3.md](v340/CODEX_V340_FINAL_ROUND3.md); bằng chứng: `docs/audits/v340/s8-round3/`.
- **Lịch sử S8 Round 2 (30/10/2026): VERDICT: NO-GO.** `S8-01: CLOSED; S8-02: CLOSED` (2/2 phát hiện cũ). Phát hiện mới `S8-R2-01` — HIGH OPEN: bộ dựng HTML PyQt6 đọc ảnh ngoài Path Allowlist qua `src` không có dấu nháy, `body background` hoặc CSS `background-image`. Bốn lệnh bắt buộc và hai probe gốc PASS; 20/20 ca bổ sung đạt cuối. Báo cáo: [CODEX_V340_FINAL_ROUND2.md](v340/CODEX_V340_FINAL_ROUND2.md); bằng chứng: `docs/audits/v340/s8-round2/`.
- **Lịch sử S8.2 Final Acceptance Audit (2026-10-30): NO-GO.** Đối chiếu đủ 9/9 hồ sơ S0–S7 GO; chạy mới TypeScript, tám bộ S1–S7 và build Webpack có kết quả cuối PASS, probe ẩn danh 116/116 PASS, đủ 20 payload. Còn 2 MEDIUM OPEN có từ S0 (`S8-01`, `S8-02`). Báo cáo: [CODEX_V340_FINAL.md](v340/CODEX_V340_FINAL.md); bằng chứng: `docs/audits/v340/s8-final/`.
- **Kiểm định độc lập S7 Round 2 (2026-10-30): GO cục bộ — 2/2 CLOSED.** Đóng `S7-01` và `S7-02`; bốn lệnh bắt buộc đạt kết quả cuối exit 0, S7-T1–T6 PASS, probe nguyên bản **116/116 PASS** và thu **20/20 payload**. Báo cáo: [CODEX_S7_ROUND2.md](v340/CODEX_S7_ROUND2.md); bằng chứng: `docs/audits/v340/s7-round2/`.
- **Kiểm định độc lập S7 Round 1 (2026-10-30): NO-GO.** Tám cổng bắt buộc và build `next build --webpack` đều đạt trên bản sao TEMP; probe độc lập 102/116 đạt, bắt 20/20 payload của năm bộ sinh AI. Còn 2 mục OPEN (`S7-01` HIGH, `S7-02` MEDIUM). Báo cáo: [CODEX_S7_ROUND1.md](v340/CODEX_S7_ROUND1.md); bằng chứng: `docs/audits/v340/s7-round1/`.
- **Kiểm định độc lập S6 Round 3 (2026-10-30): GO cục bộ.** Đóng toàn bộ **7/7 mục S6-01–S6-07**; chạy mới 20/20 ca dữ liệu/API, 34/34 ca giao diện, TypeScript và S6-T1–S6-T4 PASS. Báo cáo: [CODEX_S6_ROUND3.md](v340/CODEX_S6_ROUND3.md); bằng chứng: `docs/audits/v340/s6-round3/`.
- **Kiểm định độc lập S6 Round 2 (2026-10-30): NO-GO.** Đóng 4/7 mục (`S6-01`, `S6-05`, `S6-06`, `S6-07`); còn 3 MEDIUM sửa một phần (`S6-02`–`S6-04`). Báo cáo: [CODEX_S6_ROUND2.md](v340/CODEX_S6_ROUND2.md); bằng chứng: `docs/audits/v340/s6-round2/`.
- **Kiểm định độc lập S6 Round 1 (2026-10-30): NO-GO.** Còn 7 phát hiện OPEN (1 HIGH, 6 MEDIUM); 18/18 cổng đạt kết quả cuối. Báo cáo: [CODEX_S6_ROUND1.md](v340/CODEX_S6_ROUND1.md); bằng chứng: `docs/audits/v340/s6-round1/`.
- **Kiểm định độc lập S5b Round 3 (2026-10-30): GO cục bộ.** Đóng `S5B-02-R2`; toàn bộ **7/7 mục S5B-01–S5B-07 CLOSED**. 17/17 cổng PASS ngay lượt đầu, TypeScript PASS, 36 bản ghi độc lập đạt. Báo cáo: [CODEX_S5B_ROUND3.md](v340/CODEX_S5B_ROUND3.md); bằng chứng: `docs/audits/v340/s5b-round3/`.
- **Kiểm định độc lập S5b Round 2 (2026-10-30): NO-GO.** Đóng 6/7 mục Vòng 1; còn `S5B-02-R2` MEDIUM. Báo cáo: [CODEX_S5B_ROUND2.md](v340/CODEX_S5B_ROUND2.md); bằng chứng: `docs/audits/v340/s5b-round2/`.
- **Kiểm định độc lập S5b Round 1 (2026-10-30): NO-GO.** 6 lỗi xác nhận (2 HIGH, 4 MEDIUM) và 1 sai khác MEDIUM về ma trận công cụ App/Python. Báo cáo: [CODEX_S5B_ROUND1.md](v340/CODEX_S5B_ROUND1.md); bằng chứng: `docs/audits/v340/s5b-round1/`.
- **Kiểm định độc lập Chặng S5a Round 2 (2026-10-30): GO.** Đóng toàn bộ **3/3 phát hiện (`S5A-01`..`S5A-03`)**, vượt qua 6/6 cổng kiểm thử bắt buộc và đối chiếu 9/9 kịch bản HTML & ảnh chụp màn hình PNG với CSS biên dịch thật giống hệt từng byte (`Buffer.compare === 0`). Báo cáo: [CODEX_S5A_ROUND1.md](v340/CODEX_S5A_ROUND1.md), [CODEX_S5A_ROUND2.md](v340/CODEX_S5A_ROUND2.md).
- **Kiểm định độc lập Chặng S4 Round 3 (2026-10-30): GO trong phạm vi cục bộ.** Đóng **6/6** phát hiện từ S4 Round 1/2 (`S4-01`..`S4-03`, `S4-R2-01`..`S4-R2-03`); sáu lệnh bắt buộc và tám nhóm probe đối kháng mới đều đạt. Báo cáo: [CODEX_S4_ROUND3.md](v340/CODEX_S4_ROUND3.md).
- **Kiểm định độc lập Chặng S3 Round 5 (2026-10-30): GO.** Đóng toàn bộ **8/8 phát hiện (`S3-01`..`S3-08`)**, vượt qua 15/15 cổng kiểm thử bắt buộc cùng toàn bộ probe VM và trình duyệt Chromium thật. Báo cáo: [CODEX_S3_ROUND1.md](v340/CODEX_S3_ROUND1.md) .. [CODEX_S3_ROUND5.md](v340/CODEX_S3_ROUND5.md).
- **Kiểm định độc lập Chặng S2 Round 3 (2026-10-30): GO.** Đóng toàn bộ **6/6 phát hiện (`S2-01`..`S2-05` và `S2-R2-01`)**, vượt qua 13/13 cổng kiểm thử bắt buộc và 66/66 ca probe độc lập. Báo cáo: [CODEX_S2_ROUND1.md](v340/CODEX_S2_ROUND1.md) .. [CODEX_S2_ROUND3.md](v340/CODEX_S2_ROUND3.md).
- **Kiểm định độc lập Chặng S1 Round 2 (2026-10-30): GO.** Đóng toàn bộ **5/5 phát hiện Vòng 1 (`S1-01`..`S1-05`)** và **2/2 hạng mục đóng vòng (`R2-01`..`R2-02`)**, vượt qua 13/13 cổng kiểm thử bắt buộc, 15/15 probe đối kháng và 37/37 ca kiểm thử biên mới. Báo cáo: [CODEX_S1_ROUND1.md](v340/CODEX_S1_ROUND1.md), [CODEX_S1_ROUND2.md](v340/CODEX_S1_ROUND2.md).
- **Kiểm định độc lập Chặng S0 Round 2 (2026-10-30): GO.** Đạt GO tại snapshot `d7e3fe8`. Báo cáo: [CODEX_S0_BASELINE.md](v340/CODEX_S0_BASELINE.md), [CODEX_S0_ROUND2.md](v340/CODEX_S0_ROUND2.md).

---

## 2. LỊCH SỬ KIỂM ĐỊNH CÁC PHIÊN BẢN TRƯỚC (`v2.8.0` $\rightarrow$ `v3.3.0`)

- **Kiểm định độc lập v3.3.0 — Hoàn tất cả 4 Chặng (2026-10-29): GO.** Toàn bộ Giai đoạn 9 (`v3.3.0` — Phiếu Điểm Tổng Kết Chuẩn Teaching) đạt **GO** qua cả 4 chặng: [Chặng 1 Round 4](v330/CODEX_STAGE1_ROUND4.md) (`7/7 CLOSED`), [Chặng 2 Round 4](v330/CODEX_STAGE2_AUDIT_ROUND4.md) (`10/10 CLOSED`), [Chặng 3 Round 3](v330/CODEX_STAGE3_ROUND3.md) (`9/9 CLOSED`), và [Chặng 4 Round 3](v330/CODEX_STAGE4_ROUND3.md) (`7/7 CLOSED`, `959/959` ca probe độc lập PASS).
- **Kiểm định độc lập v3.2.0 — Vòng 5 (2026-10-28): GO.** Toàn bộ **15/15 phát hiện (`F01`–`F14` và `R4-01`) đã CLOSED**, chạy mới `npx tsc --noEmit --incremental false` PASS và `npx tsx scripts/test-teaching-project-v320.ts` PASS (6/6 nhóm `TP-01` $\rightarrow$ `TP-06`). Báo cáo: [CODEX_REVIEW_ROUND5.md](v320/CODEX_REVIEW_ROUND5.md).
- **Kiểm định độc lập v3.1.1 — Vòng 1..3 (2026-10-28): GO tại Vòng 3.** Commit `3afb54c` đã đóng cả `R2-01` và `R2-02` cùng các mục Vòng 1 (`R1-01`..`R1-04`). Chạy mới 7/7 cổng PASS, probe kết hợp 105/105 PASS. Báo cáo: [CODEX_REVIEW_ROUND1.md](v311/CODEX_REVIEW_ROUND1.md), [CODEX_REVIEW_ROUND2.md](v311/CODEX_REVIEW_ROUND2.md), [CODEX_REVIEW_ROUND3.md](v311/CODEX_REVIEW_ROUND3.md).
- **Kiểm định độc lập v3.1.0 — Vòng 4 (2026-10-28): GO.** Đã đóng `R3-01`: cả năm nhãn trạng thái và nhãn cổng SPCK giữ chữ trắng trên nền đậm; tương phản thấp nhất 5,36:1 qua đủ bốn tổ hợp màu ứng dụng/hệ điều hành. Báo cáo: [CODEX_REVIEW_ROUND3.md](v310/CODEX_REVIEW_ROUND3.md), [CODEX_REVIEW_ROUND4.md](v310/CODEX_REVIEW_ROUND4.md).
- **Kiểm định độc lập v2.9.0 — Vòng 9 (2026-10-27): GO.** Toàn bộ 12 hạng mục `F01`–`F12` đều CLOSED, chạy mới 8/8 cổng kiểm thử bắt buộc PASS và 263/263 ca probe độc lập đúng kỳ vọng (100%). Báo cáo: [CODEX_REVIEW_ROUND9.md](v290/CODEX_REVIEW_ROUND9.md).
- **Kiểm định độc lập v2.8.0 — Vòng 4 (2026-10-27): GO.** `F01`–`F04`, `R2-01`–`R2-02` và `R3-01` đều CLOSED; chạy mới 7/7 lệnh PASS, v270 đạt đủ T01–T16. Báo cáo: [CODEX_REVIEW_ROUND4.md](v280/CODEX_REVIEW_ROUND4.md).

---

## 3. CHI TIẾT CÁC VÒNG KIỂM ĐỊNH v3.3.0 PHASE 9 (STAGE 1 $\rightarrow$ STAGE 4)

### Independent audit: v3.3.0 Phase 9 Stage 1 (2026-10-29)
- **NO-GO** for TASK-9.1 / TASK-9.2: seven findings cover non-atomic version locking, raw-score validation, incomplete content hashing, drift during SAVING/FAILED, optional approval versions, decimal rounding, and snapshot class identity.
- Findings and evidence: [Stage 1 audit](v330/CODEX_STAGE1_AUDIT.md), closed in [Stage 1 Round 4](v330/CODEX_STAGE1_ROUND4.md).

### Independent audit: v3.3.0 Phase 9 Stage 2 — Rounds 1..4 (2026-10-29)
- **Round 1 (NO-GO):** Nine open findings (`S2-01`..`S2-09`). Report: [Stage 2 audit](v330/CODEX_STAGE2_AUDIT.md).
- **Round 2 (NO-GO):** Six findings CLOSED (`S2-01`, `S2-03`..`S2-06`, `S2-09`); three remain OPEN (`S2-02`, `S2-07`, `S2-08`) + `R2-01`. Report: [Stage 2 Round 2 audit](v330/CODEX_STAGE2_AUDIT_ROUND2.md).
- **Round 3 (NO-GO):** Eight of ten findings CLOSED; `S2-02` and `S2-07` remain OPEN. Report: [Stage 2 Round 3 audit](v330/CODEX_STAGE2_AUDIT_ROUND3.md).
- **Round 4 (GO):** All 10 findings CLOSED (`S2-01`..`S2-09`, `R2-01`). All six fresh verification commands PASS (exit 0). Report: [Stage 2 Round 4 closure audit](v330/CODEX_STAGE2_AUDIT_ROUND4.md).

### Independent audit: v3.3.0 Phase 9 Stage 3 — Rounds 1..3 (2026-10-29)
- **Round 1 (NO-GO):** 9 findings (`S3-01`..`S3-09`). Report: [Stage 3 audit](v330/CODEX_STAGE3_AUDIT.md).
- **Round 2 (NO-GO):** Four findings CLOSED (`S3-02`, `S3-05`, `S3-06`, `S3-09`), five PARTIALLY FIXED / OPEN. Report: [Stage 3 Round 2 closure audit](v330/CODEX_STAGE3_ROUND2.md).
- **Round 3 (GO):** All nine findings `S3-01` through `S3-09` CLOSED. Five mandatory commands freshly PASS (exit 0) + 101 CLOSED independent boundary observations. Report: [Stage 3 Round 3 closure audit](v330/CODEX_STAGE3_ROUND3.md).

### Independent audit: v3.3.0 Phase 9 Stage 4 — Rounds 1..3 (2026-10-29)
- **Round 1 (NO-GO):** Six OPEN findings (`S4-01`..`S4-06`). Report: [Stage 4 audit](v330/CODEX_STAGE4_AUDIT.md).
- **Round 2 (NO-GO):** Five Round 1 findings CLOSED (`S4-02`..`S4-06`); `S4-01` and `R2-01` OPEN. Report: [Stage 4 Round 2](v330/CODEX_STAGE4_ROUND2.md).
- **Round 3 (GO):** All seven findings CLOSED (`S4-01`..`S4-06`, `R2-01`). All seven requested commands freshly PASS (exit 0) + 959 CLOSED Round 3 probe records. Report: [Stage 4 Round 3 closure audit](v330/CODEX_STAGE4_ROUND3.md).
