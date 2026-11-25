# Báo cáo Kiểm định Độc lập — `Gemini 4 Neon (XHigh)` (`v3.8.9+`: Vá lỗi báo chưa xong Phiếu điểm Checkpoint ở Checkpoint 1)

- **Ngày kiểm định:** `25/11/2026`
- **Kiểm định viên độc lập:** `neon-reviewer` (`gemini-4-neon-xhigh`)
- **Môi trường kiểm định:** 100% cô lập trong `os.tmpdir()`, bảo toàn tuyệt đối `100%` SHA-256 trên toàn bộ dữ liệu thật trong `data/` (không dùng `send_input`).
- **Kết luận cuối cùng (Round 2):** **`VERDICT: GO`** (**`2/2` phát hiện Round 1 `F01` (P2) & `F02` (P3) đã CLOSED**, `0` lỗi P0/P1/P2/P3 mở, toàn bộ `6/6` cổng kiểm thử bắt buộc + probe bản sao DB thật `8/8` lớp `allDone: true` + toàn bộ probe đối kháng Round 2 đều **PASS `exit 0`**).

---

## 1. Phạm vi thay đổi & Callers đã rà soát
- `src/lib/report-card/report-card-staleness.ts`: Bổ sung `ComputeReportCardStalenessOptions`, `resolveSnapshotFloorSession`, `resolveEffectiveSessionForStaleness`, hợp nhất `cp1Sess`/`cp2Sess` qua `resolveCheckpointSessionsForClass` cho cả `hasNewerManualCheckpoint` và cổng `isCp1Due`/`isCp2Due` khi tính `missingCp1`/`missingCp2`; dọn sạch import thừa `isRoboticsClassCode`.
- `src/lib/dashboard/today-tasks.ts`: Truyền `{ currentSessionNumber: sessionNum, syllabusList }` vào `computeReportCardStaleness` và bổ sung `reportCardRow.teachingSyncStatus === "OUT_OF_SYNC"` vào `reportCardStale`.
- `scripts/test-streamline-v340-s4.ts`: Bổ sung `Case E` kiểm tra toàn bộ vòng đời buổi học (Buổi 3 $\rightarrow$ CP1 thiếu điểm $\rightarrow$ CP1 đã `VERIFIED` $\rightarrow$ `OUT_OF_SYNC` $\rightarrow$ CP2 thiếu điểm $\rightarrow$ CP2 hoàn chỉnh) cho Coding (`VT-CSA04-S4CP`) & Robotics (`VT-ROB-ARMS4`), kèm hồi quy `F01` (`PROBE 3b`, `PROBE 3b2/3c`).
- Callers & luồng liên quan đã rà soát sạch:
  - `src/app/api/report-card/route.ts` (`GET /api/report-card` gọi `computeReportCardStaleness(classId, parsedSnapshot)` + auto-overlay `parseReportCardLmsSnapshot` $\rightarrow$ `OUT_OF_SYNC`).
  - `src/app/api/dashboard/scan-weekly-tasks/route.ts`, `src/app/page.tsx` (`getDashboardTodayTodoCards`).
  - `src/components/teaching-report-card-view.tsx` (hiển thị banner cảnh báo `staleness`).
  - `src/lib/classes/class-directory.ts`, `src/lib/quick-tags/index.ts`, `src/lib/db/sqlite.ts` (`reportCardRepo` & chuyển trạng thái `status`/`teachingSyncStatus`), `src/lib/report-card/report-card-batch-sync.ts`.

---

## 2. Tổng hợp Đóng Phát hiện (`2/2 CLOSED` tại Round 2)

| Mã | Mức độ | Phát hiện Round 1 & Vị trí | Khắc phục & Xác minh Round 2 |
|---|---|---|---|
| `F01` | **P2 (MEDIUM)** | `resolveEffectiveSessionForStaleness` (`src/lib/report-card/report-card-staleness.ts`) trả cứng `1` khi `dirItem?.status === "Running"` và `currentSessionNumber === 0` (chưa đồng bộ `classes_sessions` hoặc các dòng `classes_sessions` chưa có `date` khi DB đã có lớp khác có `date`), dẫn đến âm tính giả bỏ sót `missingCp1`/`missingCp2` ngay cả khi `parsedSnapshot` đã có điểm `cp2*` (`PROBE 3b`) hoặc `finalProduct`/`finalCompetency` từ LMS (`PROBE 3b2`/`PROBE 3c`). | Đã bổ sung `resolveSnapshotFloorSession(activeStudents, cp1Sess, cp2Sess)` suy luận sàn buổi học tối thiểu từ điểm giai đoạn trong `parsedSnapshot` (`final* != null -> 14`, `cp2* != null -> cp2Sess`, `cp1* != null -> cp1Sess`) và áp dụng `Math.max(inferred, snapshotFloor)` trong `resolveEffectiveSessionForStaleness`; thêm test hồi quy vào `scripts/test-streamline-v340-s4.ts`. Đã kiểm chứng độc lập bằng probe Round 2 (`PROBE 3b`, `PROBE 3b2`, `finalProduct=0`, lớp `Running` mới khai giảng chưa có CP/Final vẫn không báo giả, lớp chưa có `classes_sessions` chỉ có CP1 vẫn không đòi CP2, lớp `classes_sessions` rỗng `date` `PROBE 3c`, lớp `classes_sessions` cũ ở Buổi 3 nhưng đã có điểm CP2) — tất cả **PASS 100%**. **CLOSED Round 2**. |
| `F02` | **P3 (LOW)** | Import thừa `isRoboticsClassCode` tại `src/lib/report-card/report-card-staleness.ts:9` không còn sử dụng sau khi thống nhất `resolveCheckpointSessionsForClass`. | Đã xóa sạch import `isRoboticsClassCode` khỏi `src/lib/report-card/report-card-staleness.ts`. **CLOSED Round 2**. |

*(Ghi chú advisory không chặn: `resolveCheckpointSessionsForClass` dùng regex `/(?:rob|pre[bai]|arm[bai]|semi[bai]|vex)/i` nên các mã giả định ngoài danh mục như `VT-SPIKE01`/`VT-EV3-01` không có trong `courses_syllabus.json` sẽ mặc định `[5, 9]`; tuy nhiên toàn bộ `10/10` khóa Robotics thực tế của MindX đều nằm trong `courses_syllabus.json` với `[4, 8]` và giữ đồng nhất `100%` giữa Dashboard `isCheckpointSession` và `computeReportCardStaleness`.)*

---

## 3. Toàn bộ cổng kiểm thử sau bản sửa cuối (`exit 0`, cô lập `os.tmpdir()`)

### 3.1. Bộ kiểm thử tự động
| Lệnh kiểm thử | Kết quả Round 2 |
|---|---|
| `node .\node_modules\typescript\bin\tsc --noEmit --incremental false` | **PASS (`exit 0`)** |
| `npx.cmd tsx scripts/test-streamline-v340-s4.ts` (`S4-T1..S4-T5`, `Case E`, hồi quy `F01`) | **PASS (`exit 0`)** |
| `npx.cmd tsx scripts/test-report-card-v330.ts` (`RC-01..RC-06` + `S2-01..S2-09`) | **PASS (`exit 0`)** |
| `npx.cmd tsx scripts/test-report-card-batch-sync.ts` (`BS-01..BS-09`) | **PASS (`exit 0`)** |
| `npx.cmd tsx scripts/test-checkpoint-csa04-v386.ts` (`V386-01..V386-07` + `:3095`) | **PASS (`exit 0`)** |
| `npx.cmd tsx scripts/test-admin-center-v389.ts` (`AC389-01..06`) | **PASS (`exit 0`)** |

*(Ghi chú: ở Round 1 cũng đã chạy kiểm tra chéo phần Dashboard `[S6-T1..S6-T3]` trong `scripts/test-streamline-v340-s6.ts` đều PASS; `graphify.exe` bị Windows Application Control policy chặn cục bộ trên máy chủ này).*

### 3.2. Probe độc lập Round 2 trên bản sao tạm thời của `data/mindx_bot.db` (+ `-wal`, `-shm`, `running_classes.json`, `config/`)
- **`getDashboardTodayTodoCards({ limit: 24 })`: `8/8` lớp đạt `allDone: true`**, khớp `100%` giữa `GET /api/report-card` và Dashboard trên cả `8/8` lớp:
  - `VT-JSA15` (Buổi 3, Running): `allDone=true`, `stale=false(m1=false, m2=false)`.
  - `VT-C4K-PTI12` (Buổi 3, Running): `allDone=true`, `stale=false(m1=false, m2=false)`.
  - **`VT-ROB-ARMI13`** (Buổi 4, Running, Robotics CP1): `isCheckpoint=true`, `rc=VERIFIED/VERIFIED`, `GET /api/report-card` trả `isStale: false, missingCp1: false, missingCp2: false, reasons: []`, bước `② Phiếu điểm Checkpoint` = `DONE (đã đồng bộ Teaching ✓)`, **`allDone=true`**.
  - **`VT-CSA04-HB`** (Buổi 5, Running, Coding CP1): `isCheckpoint=true`, `rc=VERIFIED/VERIFIED`, `GET /api/report-card` trả `isStale: false, missingCp1: false, missingCp2: false, reasons: []`, bước `② Phiếu điểm Checkpoint` = `DONE (đã đồng bộ Teaching ✓)`, **`allDone=true`**.
  - `VT-C4K-GI34` (Buổi 11), `VT-ROB-SEMIA05` (Buổi 13), `VT-C4K-PTA13` (Buổi 14, Finished), `VT-CSI02` (Buổi 14, Finished): đều `allDone=true`.
- Kiểm thử đột biến vòng đời trên bản sao tạm cho `VT-ROB-ARMI13` & `VT-CSA04-HB`: giữa chặng (Buổi 6/7) sạch, `OUT_OF_SYNC` chặn bước 2, tiến sang CP2 (Buổi 8/9) chưa có điểm CP2 bật `missingCp2=true` & mở lại bước 2 (`"Cần quét và đồng bộ lại"`).
- Probe đối kháng biên độc lập (`ADV-01..ADV-07` + bộ `R2 F01 PROBE 3b/3b2/3c/zero/brand-new/cp1-only/stale-dated`): **PASS 100%**, `TEMP_LEFTOVERS=0`.

---

## 4. Xác minh toàn vẹn dữ liệu thật trong `data/` (`100%` SHA-256 bất biến qua cả 2 vòng)

| Tệp dữ liệu thật | SHA-256 Trước Round 1 (`09:02Z`) | SHA-256 Sau Round 2 (`09:16Z`) | Trạng thái |
|---|---|---|---|
| `data/mindx_bot.db` | `1029C683CB7396B00E45882908FD699C3514840E2281497D5D66A97574CEEA47` | `1029C683CB7396B00E45882908FD699C3514840E2281497D5D66A97574CEEA47` | **MATCH 100%** (khớp tuyệt đối baseline coordinator) |
| `data/mindx_bot.db-wal` | `86632459D11786596317427D8E291B4FEA3D9116B27601E69F1D9CABFED926A5` | `86632459D11786596317427D8E291B4FEA3D9116B27601E69F1D9CABFED926A5` | **MATCH 100%** |
| `data/mindx_bot.db-shm` | `52E6CF6B0FA6B80CCAB5C332501473EF74A688A3FD81D4623EEB6E0759508CDC` | `52E6CF6B0FA6B80CCAB5C332501473EF74A688A3FD81D4623EEB6E0759508CDC` | **MATCH 100%** |
| `data/running_classes.json` | `4ED76890D1137C034EBF64D0FDF81559CD884F9F284E58EA48FBA4663960942B` | `4ED76890D1137C034EBF64D0FDF81559CD884F9F284E58EA48FBA4663960942B` | **MATCH 100%** suốt kiểm định *(mtime `08:59:09Z` đã đổi trước lúc giao việc `09:01:53Z`)* |
| `data/config/lms_class_ids.json` | `16D635C5C58C3A1FE79885FA3F4582AC10356BE27F75FC2C23688E4CA2DBC16F` | `16D635C5C58C3A1FE79885FA3F4582AC10356BE27F75FC2C23688E4CA2DBC16F` | **MATCH 100%** suốt kiểm định *(mtime `08:59:09Z` đã đổi trước lúc giao việc `09:01:53Z`)* |

---

## 5. Kết luận cuối cùng
**`VERDICT: GO`** — Đóng trọn **`2/2`** phát hiện (`F01`, `F02`), `0` lỗi P0/P1/P2/P3 mở, toàn bộ cổng kiểm thử & probe bản sao DB thật (`8/8` lớp `allDone: true`, xác nhận trọn vẹn `VT-ROB-ARMI13` & `VT-CSA04-HB`) đều **PASS**, dữ liệu thật `data/` bảo toàn `100%` SHA-256. Đủ điều kiện cập nhật tài liệu dự án và đồng bộ GitHub.
