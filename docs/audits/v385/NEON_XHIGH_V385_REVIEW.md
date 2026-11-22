# BÁO CÁO KIỂM ĐỊNH ĐỘC LẬP `v3.8.5` — GEMINI 4 NEON (XHIGH)

- **Ngày kiểm định:** `22/11/2026`
- **Mô hình Reviewer độc lập:** `Gemini 4 Neon (XHigh)` (`gemini-4-neon-xhigh`, worker `xhigh-verifier` chạy cô lập trong `os.tmpdir()`)
- **Phạm vi nâng cấp & kiểm định:**
  - `src/lib/checkpoint/competency-specs.ts`, `src/lib/checkpoint/checkpoint-competency.ts`, `src/lib/local-files/spck-demo-score-reader.ts`: Bổ sung đầy đủ `4` mã `commentAreaId` & nhãn Robotics (`668e5146e71f90e7630da552`/`a552` — `[ROB-ĐNL] Kỹ năng sử dụng máy tính`, `668e5005e71f90e7630da316`/`da316` — `[ROB-ĐNL] Kỹ năng giải quyết vấn đề`, `668e50ade71f90e7630da4b2`/`a4b2` — `[ROB-ĐNL] Tư duy sáng tạo mô hình`, `668e49ebe71f90e7630d9433`/`9433` — `Tư duy máy tính, tư duy thuật toán.ROB.ĐNL2024`), cùng hàm `matchesCompetencyAreaIdPure` đối chiếu chính xác 24 ký tự hex trước khi kiểm tra hậu tố (chặn va chạm `da316` với `0d4316` của `skillCommunication`), loại trừ `RATE` không thuộc 9 `[ĐNL]` (VD: `670777c055bde44038509a1b` `grade: 0`), giữ tương thích `node:vm` & Buổi 14.
  - `src/lib/playwright/save-comments.ts`: Tách bộ phân giải DOM 9 nhóm radio `[ĐNL]` / `[ROB-ĐNL]` thành chuỗi JS thuần `RESOLVE_CP_RADIOS_BROWSER_SCRIPT` chạy qua `new Function("rootEl", "specs", payload.script)` (triệt tiêu 100% lỗi `ReferenceError: __name is not defined` khi `esbuild`/`tsx` biên dịch, lưu `evalError` để chẩn đoán thay vì nuốt lỗi im lặng); hỗ trợ DOM thực tế 46 `<input type="radio">` không có `name`/`value` (`0..44` `name="" value=""`, để nguyên radio khảo sát `idx 45`), thứ tự hoán đổi Robotics (`knowledgeInClass` trước `knowledgeSelfStudy`), bỏ qua tiêu đề `[ĐNL2024] Checkpoint` (0 radio), giữ chốt `fail-closed` `F01a/b/c` với `CHECKPOINT_COMPETENCY_DOM_MISMATCH` (`0` chạm LT/TH, checkbox câu hỏi, `<textarea>` hay radio khảo sát); gọi `markCheckpointLmsCompetencyVerified` ở cả xác minh tức thì (Pass 1) lẫn đối chiếu View-Mode (Pass 2B).
  - `src/lib/db/sqlite.ts`, `src/lib/playwright/sync-class.ts`, `src/app/session-comments/page.tsx`: Thêm `sessionFeedbackRepo.markCheckpointLmsCompetencyVerified` khóa `status='VERIFIED'` & `contentHash`; `ClassSyncer` chặn gắn nhầm hoặc hạ `VERIFIED` $\rightarrow$ `APPROVED` cho các bản ghi `v3.7.0+` khi LMS thiếu hoặc lệch `9/9` `RATE` (vẫn bảo vệ nguyên vẹn dữ liệu lịch sử trước `v3.7.0`); `/session-comments` bổ sung `hasMatchingCheckpointLmsCompetency`, `needsStudentCheckpointLmsTick`, nhãn `cp-lms-tick-status-*` (`✓ Đã tích LMS` / `⏳ Chưa tích LMS`) đạt WCAG AA Sáng/Tối và luồng tích bù 1-chạm (`"✅ Duyệt & Đẩy LMS"` / `save-single-btn-*`).
  - `package.json`, `src/components/top-navbar.tsx`, `src/app/layout.tsx`, `scripts/test-checkpoint-auto-v370.ts` (`[V370-09]`).

---

## 1. Kết quả các vòng kiểm định

- **Vòng 1 (`22/11/2026 18:00`):** `VERDICT: NO-GO` — `9/9` bộ test nền PASS, phát hiện **`4/4` điểm (`3× P1`, `1× P2`)** bằng probe cô lập trên `os.tmpdir()` + Chromium thật + `esbuild (keepNames: true)`:
  1. `F01 [P1]` (`src/app/session-comments/page.tsx:396-405, 4656-4672`): `needsStudentCheckpointLmsTick` và nhãn `cp-lms-tick-status-*` chỉ kiểm tra `lmsCompetencyScores` khác `null`, dẫn đến báo nhầm xanh `✓ Đã tích LMS` và khóa nút tích bù khi LMS có `9` ô `RATE` khác với `competencyScores` cục bộ (sau `ClassSyncer` hạ trạng thái hoặc giáo viên chỉnh tay sao `[ĐNL]`). $\rightarrow$ **ĐÃ ĐÓNG Ở VÒNG 2** (bổ sung `hasMatchingCheckpointLmsCompetency(cp)` thuần tương thích `node:vm`, đối chiếu đủ cả 9 khóa).
  2. `F02 [P1]` (`src/lib/playwright/save-comments.ts:1077, 1494, 1555, 1572-1584`): `alreadySavedAndVerifiedInViewMode` tự đóng Modal mà không bấm `Edit` để tích `9` ô `[ĐNL]` khi bản ghi `VERIFIED` có nhận xét không chứa chữ `[ĐNL]` / `Điểm năng lực` (dù `desiredCompetencyScores` khác rỗng); đồng thời regex nhận diện View-Mode bỏ sót `[ROB-ĐNL]`, `[ĐNL2024]` và `.ROB.ĐNL2024`. $\rightarrow$ **ĐÃ ĐÓNG Ở VÒNG 2** (cấm đặt `alreadySavedAndVerifiedInViewMode = true` khi `desiredCompetencyScores` có giá trị và mở rộng regex hỗ trợ đủ `[ROB-ĐNL]` / `[ĐNL2024]` / `.ROB.ĐNL2024`).
  3. `F03 [P1]` (`src/lib/playwright/save-comments.ts:180-194, 245-250`): Nhánh DOM sibling phẳng có 1 dòng tiêu đề khớp `> 1` tiêu chí kèm `value="1".."5"` vẫn vượt qua `isValidFiveRadioGroup` do nhánh `candNormText !== null` chưa kiểm tra `countMatchingSpecs(candNormText, allSpecs) !== 1`. $\rightarrow$ **ĐÃ ĐÓNG Ở VÒNG 2** (loại ngay ở vòng thu thập ứng viên `countMatchingSpecs(t, specs) !== 1` và siết cả 2 nhánh trong `isValidFiveRadioGroup`).
  4. `F04 [P2]` (`src/lib/db/sqlite.ts:1110-1117`): `markCheckpointLmsCompetencyVerified` ép kiểu `null`, `""`, `0`, `6`, `boolean` và số thập phân thành `1..5` thay vì trả về `false`. $\rightarrow$ **ĐÃ ĐÓNG Ở VÒNG 2** (kiểm tra chặt `typeof rawVal === "number" && Number.isInteger(rawVal) && rawVal >= 1 && rawVal <= 5` cho đủ 9 khóa).

- **Vòng 2 (`22/11/2026 18:08`):** **`VERDICT: GO`** — đóng trọn **`4/4` phát hiện `F01`–`F04`** (`0` lỗi P0/P1/P2 mở), **`15/15`** probe đối kháng độc lập (`Chromium` + `esbuild keepNames:true` + `node:vm` + SQLite CAS) PASS, `LEFTOVER_TEMP=0`, toàn bộ `9/9` bộ kiểm thử chính PASS sau lần chỉnh sửa cuối cùng.

---

## 2. Kết quả kiểm thử & bảo toàn SHA-256 dữ liệu thật

- `node .\node_modules\typescript\bin\tsc --noEmit --incremental false` $\rightarrow$ **PASS (`exit 0`)**
- `npx.cmd tsx scripts/test-checkpoint-auto-v370.ts` (`V370-01..V370-09`, gồm DOM thật 46 radio `name="" value=""`, `esbuild keepNames:true`, Robotics `[ROB-ĐNL]` / `.ROB.ĐNL2024`, `F01a/b/c`, `ClassSyncer` & E2E Light/Dark `:3099`, hồi quy `F01`–`F04`) $\rightarrow$ **PASS (`exit 0`)**
- `npx.cmd tsx scripts/test-checkpoint-v300.ts` (`CP-01..CP-05`) $\rightarrow$ **PASS (`exit 0`)**
- `npx.cmd tsx scripts/test-spck-v360.ts` (`V360-01..V360-05` + `Round-38`) $\rightarrow$ **PASS (`exit 0`)**
- `npx.cmd tsx scripts/test-drive-thumbnails-v363.ts` (`V363-01..V363-06`) $\rightarrow$ **PASS (`exit 0`)**
- `npx.cmd tsx scripts/test-save-comments-timeout-v348.ts` (`9/9 SCT-01..SCT-08B`) $\rightarrow$ **PASS (`exit 0`)**
- `npx.cmd tsx scripts/test-phase4-codex-repros.ts` (`Round 1 -> Round 17`) $\rightarrow$ **PASS (`exit 0`)**
- `npx.cmd tsx scripts/test-streamline-v340-s3.ts` (`S3-01..S3-08`) $\rightarrow$ **PASS (`exit 0`)**
- `npx.cmd tsx scripts/test-session-comments-open-lms.ts` (`OL-01..OL-06`) $\rightarrow$ **PASS (`exit 0`)**
- Probe đối kháng độc lập Round 2 của `xhigh-verifier` (`15/15 PASS`, `exit 0`, `0` pageErrors).
- `$env:GRAPHIFY_BACKEND="none"; graphify update .` $\rightarrow$ **PASS (`exit 0`, `2.581` nodes / `9.361` edges / `95` communities)**
- **Bảo toàn `100%` SHA-256 dữ liệu thật trước = sau kiểm định (tính bằng Node `fs.readFileSync` không đụng lock SQLite của `:3000`):**
  - `data/mindx_bot.db`: `4018E659F9D4C892C10A535ECBE9F38658A56FF009691E4897FA7A44C58BFFCD`
  - `data/mindx_bot.db-wal`: `BB945021E89CE0E6C58E3B48BAF2C948E46C549E4AD03E28AF24912A1A91E1A6`
  - `data/running_classes.json`: `1D0EE2A624B5108E35E791A98465DB48060798560841F6E2880D045D011D37FA`
  - `data/config/lms_class_ids.json`: `AC93C6A821E9D6FA8B148E82EC1D56B5FFEB627EE300935DE97AE3A62F7FA188`
