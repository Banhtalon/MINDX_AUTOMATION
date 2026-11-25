# Báo cáo Kiểm định Độc lập — MindX Bot `v3.8.10` (`25/11/2026`)

- **Phạm vi kiểm định:** Bỏ kiểm tra ô `homework` (BTVN) cho khối Robotics trên `/admin-center` & phân biệt học sinh nghỉ chờ học bù vs học sinh đi học chưa nhập điểm ở buổi Checkpoint (`CP1`, `CP2`, `DEMO`).
- **Đơn vị kiểm định độc lập:** `Gemini 4 Neon (XHigh)` (`gemini-4-neon-xhigh`, worker `neon-v3810-auditor`).
- **Kết luận cuối (Round 2):** **`VERDICT: GO`** — đóng trọn **`4/4` phát hiện Round 1 (`F01`–`F04`)**, **`0` lỗi P0/P1/P2/P3 mở**.

## 1. Các tệp thay đổi được kiểm định (`v3.8.10`)
- `src/lib/admin-center/admin-types.ts` — Mở rộng `AdminWeeklyCheckpointAlert` (`missingStudentNames`, `absentMakeupCount`, `absentMakeupStudentNames`, `isMakeupPendingOnly`, tương thích ngược JSON SQLite cũ).
- `src/lib/admin-center/admin-teaching-scraper.ts` — Hợp nhất `isMakeupCancelledStatus`, `isMakeupCompletedStatus`, `isCompletedOrCancelledMakeupStatus`; bổ sung `attendanceStatus` & `allMakeupByClass` (trong `fetchAdminTeachingOverviewPages`) để luồng quét thật giữ đủ trạng thái đã học bù/đã hủy cho đối chiếu Checkpoint mà không làm lẫn `MAKEUP_DEBT` chờ học bù.
- `src/lib/admin-center/admin-lms-scanner.ts` — Bỏ yêu cầu `evalSlot.homework` khi `blockType === "ROBOTICS"`; xây dựng `buildCheckpointAlertForMilestone` (`CP1` B4/5, `CP2` B8/9, `DEMO` B14 gồm `Demo2024 | ROB` `demoQuestions` & miễn `PTB`/`CSB`), dùng `studentId`-first cho HV trùng tên, loại ngày tháng khỏi `sessionLabel`, dùng `allMakeupByClass` và lọc sạch `5e. Makeup debt`; loại trừ `isMakeupPendingOnly` khỏi KPI `weeklyOpsIssuesCount`.
- `src/components/admin-center/admin-ui-helpers.ts`, `src/components/admin-center/AdminTabsContent.tsx`, `src/lib/admin-center/admin-zalo-reminder.ts` — Hiển thị nhãn `Đủ Tổng kết buổi` / `Thiếu Tổng kết buổi` riêng cho Robotics (không nhắc `BTVN`), hiển thị thẻ xanh dịu `🕒 ... nghỉ chờ học bù` khi chỉ chờ học bù và loại trừ khỏi mục thiếu vận hành/Zalo nhắc việc thiếu điểm.
- `package.json`, `src/app/layout.tsx`, `src/components/top-navbar.tsx` — Nâng nhãn phiên bản `MindX Bot v3.8.10` (giữ nguyên chuỗi lịch sử `MindX Bot v3.6.3` ở comment).
- `scripts/test-admin-center-robotics-cp-v3810.ts` — Bộ kiểm thử tự động `6/6` kịch bản trong `os.tmpdir()`.

## 2. Tổng hợp đóng phát hiện (`4/4 CLOSED`)
- **F01 [P1] — CLOSED:** Bổ sung `allMakeupByClass` (`includeAll: true`) + `attendanceStatus` trong `admin-teaching-scraper.ts`, nối `teachingAllMakeupRows` qua `scanAdminCenterClasses()`, và lọc `isCompletedOrCancelledMakeupStatus` ở mục `5e`. Xác minh trực tiếp `R2-P1`, `R2-P2`, `R2-P6`.
- **F02 [P2] — CLOSED:** Loại bỏ ngày tháng (`YYYY-MM-DD`, `DD/MM/YYYY`), dùng `matchAll` với ranh giới trái `(?:^|[^\p{L}\p{N}_])` và hỗ trợ `[:#]?`. Chặn sạch `"PREB04 - Buổi 6"`, `"Lab 4"`, `"04/11/2026"`; khớp đúng `"Buổi 3, Buổi: 4"`, `"B3-B4"`, `"Buổi #04"` (`R2-P3`).
- **F03 [P2] — CLOSED:** Dùng chung helper `isMakeupCancelledStatus` / `isMakeupCompletedStatus` cho đủ biến thể `Đã huỷ`, `Hủy lịch`, `Cancelled`, `Đã học`, `Completed`, `Done`, `attendanceStatus = Có mặt` (`R2-P4`).
- **F04 [P3] — CLOSED:** `stripHtmlPlain(att?.comment) || stripHtmlPlain(stageNote)` ngăn HTML rỗng `<p></p>` che mất `stageNote` (`R2-P5`).

## 3. Cổng kiểm thử & Toàn vẹn dữ liệu thật (Sau bản sửa cuối, `exit 0`)
- `node .\node_modules\typescript\bin\tsc --noEmit --incremental false`: **PASS (`0`)**
- `npx.cmd tsx scripts/test-admin-center-robotics-cp-v3810.ts`: **PASS (`0`, `6/6`)**
- `npx.cmd tsx scripts/test-admin-center-v389.ts`: **PASS (`0`, `[AC389-01..06]`)**
- `npx.cmd tsx scripts/test-admin-center-v350.ts`: **PASS (`0`, `[AC-01..AC-13]`)**
- Probe đối kháng Round 2 (`R2-P1..R2-P6` chạy trong `os.tmpdir()`, `0` tệp tạm sót): **PASS (`0`, `6/6`)**
- **SHA-256 dữ liệu thật `data/` TRƯỚC & SAU khớp 100%:**
  - `data/mindx_bot.db`: `1029C683CB7396B00E45882908FD699C3514840E2281497D5D66A97574CEEA47`
  - `data/running_classes.json`: `DCDFC9195A37972362E2717FF6093B19582890D41311A6C5DB3ECC7FC57E1012`
  - `data/config/lms_class_ids.json`: `16D635C5C58C3A1FE79885FA3F4582AC10356BE27F75FC2C23688E4CA2DBC16F`
