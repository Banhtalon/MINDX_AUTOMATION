# BÁO CÁO KIỂM ĐỊNH ĐỘC LẬP `Gemini 4 Neon (XHigh)` — MindX Bot `v3.7.0`

- **Ngày kiểm định:** `2026-11-21`
- **Phiên bản:** `v3.7.0` (Tự động tính & tích `9` ô `[ĐNL]` Checkpoint Buổi 4/8 Robotics & Buổi 5/9 Coding trên thang `5`, gắn dòng điểm tổng kết Checkpoint `📊 **Kết quả Checkpoint [1/2]:** ...` & tổng quan Zalo nhóm không lộ điểm từng cá nhân)
- **Auditor độc lập:** `Gemini 4 Neon (XHigh)` (`neon-xhigh-auditor`)
- **Kết luận cuối cùng (Round 3):** **`VERDICT: GO`** (`9/9` phát hiện `F01`–`F07` + `R2-F01`–`R2-F02` ĐÃ ĐÓNG, `0` lỗi P0/P1/P2 mở)

---

## 1. Tiến trình Kiểm định qua 3 Vòng

1. **Round 1 (`NO-GO` — 1 P0 | 5 P1 | 1 nhóm P2 — sau khi gỡ kẹt lệnh `npx tsx -e` nhiều dòng lúc 10:15):**
   - `F01` (P0 — `src/lib/playwright/save-comments.ts`): Chặn `FLAT_45` fallback khi có `dialogLoc.evaluate`, không để bộ chọn DOM chạm nhầm radio/input câu hỏi trắc nghiệm hay `<textarea>`, xác thực đủ `9` nhóm 5 radio cùng `name` với giá trị `1..5` tách biệt (hỗ trợ cả layout phẳng dạng sibling), chờ radio mount tối đa `2500ms` ở Read-after-Write, và bỏ phân loại timeout mù khi đã tích đủ `>= 9` ô `[ĐNL]`.
   - `F02` (P1 — `sqlite.ts`, `sync-class.ts`, `save-comments.ts`, `save-draft/approve`): Chuẩn hóa canonical key-order `extractCheckpointCoreSnapshotHash`; `ClassSyncer` giữ `approvedSnapshotHash` khi điểm không đổi và xóa hash + hạ `APPROVED` / placeholder-`VERIFIED` $\rightarrow$ `DRAFT` + làm mới dòng điểm + tăng `rowVer` khi điểm LMS đổi; thêm `CHECKPOINT_DATA_DRIFT` CAS trong `approveConditional`; khóa Rule 4 `VERIFIED -> APPROVED` trong `upsert`; kiểm tra in-flight hash trong `save-comments.ts`.
   - `F03` (P1 — `src/app/api/session-comments/checkpoint-sync/route.ts`): Xác thực kiểu boolean, quyền sở hữu `sessionId` thuộc `classId`, và `isCheckpoint` (`400`) trước khi gọi `ClassSyncer.syncClass`.
   - `F04` (P1 — `checkpoint-competency.ts`, `comment-generator.ts`, `save-draft/approve/route.ts`, `session-comments/page.tsx`): Hợp nhất đồng nhất qua `mergeCheckpointStudentData` để giữ trọn `competencyScores` & `processSummary`.
   - `F05` (P1 — `checkpoint-history-loader.ts`, `session-comments/page.tsx`): `computeCheckpointDataForSession` chỉ ghi SQLite khi `persist === true`, nhắm đúng học viên active + bản ghi feedback hiện có, và UI tải lại đầy đủ `loadClassData` sau khi bấm `↻ Tính lại [ĐNL]` / `📥 Đọc điểm KT & Tính [ĐNL]`.
   - `F06` (P1 — `checkpoint-competency.ts`): Zalo Checkpoint loại học sinh `ABSENT`/`EXCUSED`/chưa có điểm thi thật (`LT/TH >= 3.5` và ngưỡng `>= 4.0`) khỏi danh sách tuyên dương dù có huy hiệu cũ, tính thống kê lớp chỉ trên nhóm có điểm thi, khử trùng lặp tên ngắn.
   - `F07` (P2 — `checkpoint-competency.ts`, `comment-generator.ts`, `test-spck-v360.ts`): Làm sạch payload `checkpointData` từ client, giữ trường số cho `previousCheckpoint`, chống đếm trùng `RATE` cùng `commentAreaId`, và cập nhật regex banner `TopNavbar` lên `/^MindX Bot v3\.\d+\.\d+$/`.
2. **Round 2 (`NO-GO` — đóng 7/7 `F01`–`F07`, phát hiện thêm 1 P1 + 1 P2 biên):**
   - `R2-F01` (P1 — `src/lib/db/sqlite.ts`): Khi đồng bộ thường lưu `competencyScores: null` và UI nạp `competencyScores` suy diễn qua `GET /list`, `approveConditional` báo nhầm HTTP `409 CHECKPOINT_DATA_DRIFT`. Khắc phục bằng helper `extractCheckpointCoreFields` chỉ cho phép bổ sung lần đầu `competencyScores: null -> 9 scores` khi `cpStage`, `theoryScore` và `practiceScore` khớp DB (`100%`), giữ fail-closed `CHECKPOINT_DATA_DRIFT` cho mọi sửa đổi khác.
   - `R2-F02` (P2 — `save-draft/route.ts`, `approve/route.ts`): Bảo toàn `lmsCompetencyScores`, `processSummary`, `lmsSyncedAt`, `computedAt` khi client gửi bản nháp/duyệt từng phần chứa giá trị `null`.
3. **Round 3 (`VERDICT: GO` — đóng trọn 9/9, 0 lỗi mở):**
   - Auditor xác minh `R3-F01` & `R3-F02` trên `os.tmpdir()` (gồm toàn bộ kịch bản dương tính & âm tính drift/clobber) và chạy lại toàn bộ cổng kiểm thử chịu ảnh hưởng (`8/8 PASS`, `LEFTOVER_TEMP=0`).

---

## 2. Cổng Kiểm thử & Toàn vẹn Dữ liệu

- **TypeScript:** `npx.cmd tsc --noEmit --incremental false` → **PASS (`exit 0`)**
- **Kiểm thử tự động sau bản vá cuối (`R2-F01` + `R2-F02`):**
  - `npx.cmd tsx scripts/test-checkpoint-auto-v370.ts` (`V370-01..V370-08` trên Live Chromium `:3099` Light/Dark + `F01..F07` & `R2-F01..R2-F02`) → **PASS (`exit 0`)**
  - `npx.cmd tsx scripts/test-checkpoint-v300.ts` (`CP-01..CP-05`) → **PASS (`exit 0`)**
  - `npx.cmd tsx scripts/test-save-comments-timeout-v348.ts` (`9/9 SCT-01..SCT-08B`) → **PASS (`exit 0`)**
  - `npx.cmd tsx scripts/test-phase4-codex-repros.ts` (`Round 1 -> Round 17`) → **PASS (`exit 0`)**
  - `npx.cmd tsx scripts/test-streamline-v340-s3.ts` (`S3-01..S3-08`) → **PASS (`exit 0`)**
  - `npx.cmd tsx scripts/test-session-comments-open-lms.ts` (`OL-01..OL-06`) → **PASS (`exit 0`)**
  - Bộ probe Round 3 của auditor (`scratch/v370_audit_probe_r3.ts`) → **PASS (`exit 0`)**
- **Hồi quy mở rộng đã PASS trong đợt kiểm định v3.7.0 (trước bản vá hẹp `R2-F01/R2-F02` trên `sqlite/save-draft/approve`):**
  - `npx.cmd tsx scripts/test-spck-v360.ts` (`V360-01..V360-05` + `Round-38`) → **PASS (`exit 0`)**
  - `npx.cmd tsx scripts/test-drive-thumbnails-v363.ts` (`V363-01..V363-06`) → **PASS (`exit 0`)**
  - `npx.cmd tsx scripts/test-quick-tags-v300.ts` → **PASS (`exit 0`)**
- **Bảo toàn `100%` SHA-256 trên cả `4/4` tệp dữ liệu thật (khớp baseline trước và sau cả 3 vòng):**
  - `data/mindx_bot.db`: `3585CB509D2F57C67F91E1CCA46AC65186750C8BBE4872198242C9E4F5C404DC`
  - `data/mindx_bot.db-wal`: `31F2507D1737DB9C1D3940395B48474E9369983F0CD23D0FBA044FED50B7A156`
  - `data/running_classes.json`: `068CD27C8F60D0A7C8FCB9C02136D62078D8B918F93B0DAA818BB46DCE25C795`
  - `data/config/lms_class_ids.json`: `AC93C6A821E9D6FA8B148E82EC1D56B5FFEB627EE300935DE97AE3A62F7FA188`
