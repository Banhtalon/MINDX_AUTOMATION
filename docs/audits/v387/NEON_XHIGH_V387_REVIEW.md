# Báo Cáo Kiểm Định Độc Lập `v3.8.7` — Gemini 4 Neon (XHigh) (Round 3 — Final)

- **Phiên bản kiểm định:** `v3.8.7` (Tự động chấm bài thực hành Checkpoint `CP1 Buổi 5` & `CP2 Buổi 9` thang điểm nguyên `0..100` trên MindX LMS `#tabpanel-3` + Sandbox Python 3.12 cô lập kiểm chứng thực nghiệm `.ipynb`/`.py` + Tạo Barem 100 điểm từ văn bản/ảnh đề bài + Khóa an toàn Robotics/vắng mặt/thiếu file code)
- **Reviewer độc lập:** `reviewer` (`Gemini 4 Neon (XHigh)` — `gemini-4-neon-xhigh`)
- **Ngày kiểm định:** `24/11/2026` (Round 1 → Round 2 → Round 3)
- **Môi trường cô lập:** 100% kiểm thử & probe đối kháng chạy trong `os.tmpdir()` (`$env:TEMP`), không chạm máy chủ `:3000`, `./playwright-auth` hay ghi vào `data/`.

---

## VERDICT: GO

**Kết luận nghiệm thu cuối cùng (Round 3):**
- Đóng trọn **`18/18`** phát hiện qua 3 vòng kiểm định (`F01`–`F15` Round 1 + `R2-F01`–`R2-F03` Round 2) — **`0` lỗi P0 / P1 / P2 / P3 mở**.
- Toàn bộ cổng biên dịch, kiểm thử tính năng mới và hồi quy trong `$env:TEMP` đều **PASS (`exit 0`)**:
  - `node .\node_modules\typescript\bin\tsc --noEmit --incremental false`
  - `node .\node_modules\tsx\dist\cli.mjs scripts/test-checkpoint-grader-v386.ts` (`CPG-01..CPG-06`, bao phủ toàn bộ 18 ca hồi quy `F01..F15` & `R2-F01..R2-F03`)
  - `scripts/test-homework-hide-scores-v369.ts`, `scripts/test-phase5.ts`, `scripts/test-lms-reliability-v280.ts`, `scripts/test-checkpoint-auto-v370.ts`, `scripts/test-streamline-v340-s4.ts`, `scripts/test-phase4-codex-repros.ts`, `scripts/test-report-card-v330.ts` (`RC-01..RC-06`), cùng kiểm tra giao diện trực tiếp Sáng/Tối (`1440×900` & `1280×800`) trên `/homework-grader?classId=VT-CSA04-HB` (`0` lỗi console/page).
- Toàn bộ probe tấn công độc lập Round 3 (`R3-PROBE-1..R3-PROBE-3`) đều **PASS `100%`**.
- An ninh & toàn vẹn dữ liệu đạt chuẩn tuyệt đối: `0` bí mật môi trường rò ra `'use client'`, `0` tệp `TEST_*` hay CSV mồ côi tồn dư, và **`4/4` tệp dữ liệu thật trong `data/` bảo toàn `100%` SHA-256** xuyên suốt cả 3 vòng.

---

## 1. Bảng Theo Dõi Đóng Phát Hiện Qua 3 Vòng (`18/18` CLOSED)

| Mã | Vòng | Mức độ | Tóm tắt phát hiện & cách đóng | Trạng thái |
|---|---|---|---|---|
| `F01` | R1 | P0 | `python-notebook-verifier.ts`: Thoát Sandbox Python 3.12 qua `_winapi.CreateProcess`, `os.open` bitmask ghi ngoài sandbox, `sqlite3.connect`, `ctypes.*`, `os.chdir` và giả mạo JSON trên `stdout` → Chuyển sang mở sẵn file handle kết quả kèm `nonce` 128-bit ở `resultDir` riêng (`stdio: ignore`), khóa `BLOCKED_IMPORT_TOP` + `BLOCKED_PREFIXES` + `BLOCKED_EXACT`, kiểm tra bitmask `O_WRONLY\|O_RDWR\|O_CREAT\|O_TRUNC\|O_APPEND` & chặn `int` fd, bắt `BaseException`. | **CLOSED (R2/R3)** |
| `F02` | R1 | P0 | `rubric-ai/route.ts` & `python-notebook-verifier.ts`: Path Traversal qua `rubricId = ".."` trỏ lên `data/config/` → Bổ sung `isValidSafeRubricId` (`^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$`, cấm `.`) và kiểm tra `path.resolve(dsDir)` nằm chặt bên trong `checkpoint-datasets/`. | **CLOSED (R2)** |
| `F03` | R1 | P1 | `scripts/test-checkpoint-grader-v386.ts`: `dbMulti.localFilePath` có kiểu `string \| undefined` làm `tsc --noEmit` báo lỗi → Bổ sung `assert.ok(dbMulti.localFilePath)`. | **CLOSED (R2)** |
| `F04` | R1 | P1 | `grade-worker.ts` & `download-submissions.ts`: `tagAndScanLmsRows` chỉ tìm `ExpandMoreIcon` nên mất dòng học viên sau khi mở rộng (`ExpandLessIcon`) trên MUI thật → Quét đồng thời `svg[data-testid="ExpandMoreIcon"], svg[data-testid="ExpandLessIcon"]`. | **CLOSED (R2)** |
| `F05` | R1 | P1 | `grade-worker.ts`: `normalizeComparableNoteText` xóa mất đoạn giữa `<` và `>` (VD `x < 10 và y > 5`, `<div>`) khi đọc `innerText()` của `.ql-editor` → Tách `normalizePlainEditorText` giữ nguyên ký tự `<`/`>` cho plain text editor. | **CLOSED (R2)** |
| `F06` | R1 | P1 | `download-submissions.ts`: SSRF qua HTTP 302 redirect, nhánh fallback bỏ qua allowlist/trần 25MB, `.mindx.local` bật ở prod, `arrayBuffer()` tràn RAM & selector chưa escape tên file → Dùng `redirect: "manual"` / `maxRedirects: 0` tối đa 3 bước kiểm tra `isAllowedDownloadUrl`, đọc stream giới hạn `25MB`, khóa `.mindx.local` sau `MINDX_ALLOW_TEST_HOSTS === "1"`, escape selector và xóa `tmpSinglePath` sau khi đóng gói `_bundle.zip`. | **CLOSED (R2)** |
| `F07` | R1 | P1 | `homework-grader.ts`: Kẹp điểm `earnedPoints` ngoài khoảng `[0, maxPoints]` làm lọt `ScoreAuditor` + tên riêng phân tách bởi `_` trong tên file (`CSA04_thien_Checkpoint1.ipynb`) và SĐT lọt qua scrubber → Chỉ `Math.round` khi nằm trong `[0, matchedMax]`, bật `redactContactInfo: true` và scrub tên riêng phân tách bởi `_`/`-`/`.` ở tên file. | **CLOSED (R2)** |
| `F08` | R1 | P1 | `python-notebook-verifier.ts` & `homework-grader.ts`: Regex `subIdMatch` tham lam trên tên gói `_bundle.zip` và chưa giải nén `.zip` do học sinh nộp → Truyền tường minh `submissionId` vào `runIsolatedPythonSubmissionVerification` và bổ sung giải nén an toàn `.ipynb`/`.py`/`.csv` từ `.zip`. | **CLOSED (R2)** |
| `F09` | R1 | P1 | `checkpoint-grader-panel.tsx` & `homework-grader/page.tsx`: Đổi lớp khi đang chạy làm kẹt `anyBusy = true` + đua `onBlur` vs click `Duyệt` → Khóa `<ClassPicker>` khi `checkpointPanelBusy`, reset cờ busy khi đổi scope, gom promise lưu nháp qua `pendingDraftPromisesRef` và chặn `onBlur` thừa khi nhấn `Duyệt`. | **CLOSED (R2)** |
| `F10` | R1 | P2 | `grade-worker.ts`: Đóng modal khi vòng `altBtn` không khớp tên file nhưng vẫn chạy tiếp, kiểm `--/100` trên cả cell 2 task, và tự làm tròn điểm thập phân BTVN thường → Thêm chốt fail-closed `!matchedAlt`, decode `%20`, kiểm phạm vi từng task và từ chối điểm thập phân trên `#tabpanel-3`. | **CLOSED (R2)** |
| `F11` | R1 | P2 | `download-submissions.ts` & `submissions/route.ts`: Lượt tải hàng loạt kéo cả bài đã chấm tay `GRADED` trên LMS về chấm đè + thiếu guard ở `POST /submissions` → Bỏ qua bài `GRADED` trên LMS trong batch mode (trừ khi chỉ định `studentId`) và chặn Robotics/`REDO`/điểm lẻ ở `POST /submissions`. | **CLOSED (R2)** |
| `F12` | R1 | P2 | `checkpoint-grader-panel.tsx`, `rubric-ai/route.ts` & `checkpoint-rubric-generator.ts`: UI mở `.xlsx` nhưng API chặn, tự cắt `>8` tiêu chí, chưa gỡ markdown fence JSON → Giới hạn `accept=".csv,.tsv,.txt"`, khóa tối đa 8 tiêu chí trả `400` tường minh, gỡ fence ````json` trước `JSON.parse`. | **CLOSED (R2)** |
| `F13` | R1 | P2 | `python-notebook-verifier.ts`: `detectStaleCellOutputMismatch` bỏ sót khi code mới không in gì, chuỗi ngắn `<20` ký tự hoặc code mới báo `ERROR` → Chuẩn hóa hàm `detectStaleCellOutputMismatch` bắt chặt mọi ca lệch output cũ vs chạy thật và gỡ giới hạn cắt 16KB nhờ file kết quả riêng. | **CLOSED (R2)** |
| `F14` | R1 | P2 | `checkpoint-grader-panel.tsx`, `homework-grader/page.tsx` & `teaching-report-card-view.tsx`: Nhãn `Lỗi lưu` thiếu `mindx-dark-keep` ở Light Mode, ẩn nút thử lại bài `FAILED` có `contentHash`, và Phiếu Điểm chưa tự làm mới sau khi lưu LMS → Thêm `mindx-dark-keep` (WCAG AA), mở nút `Thử lại LMS` cho `FAILED` có `contentHash`, và phát sự kiện `mindx:report-card-refresh` kèm `ScoreScraper.scrapeClassScores` tự động. | **CLOSED (R2)** |
| `F15` | R1 | P3 | `checkpoint-column-resolver.ts`, `homework-completion-helpers.ts`, `rubric-ai/route.ts` & `download-submissions.ts`: Loại trừ tiêu đề `^bài tập` khỏi cột Checkpoint, nhận diện `"Bài kiểm tra lần 1/2"` -> `"CP 1"`/`"CP 2"`, kiểm đủ 8 byte PNG + chặn kích thước chuỗi base64 trước decode, và gắn `[MISSING_CODE_FILE]` cho `.zip` chỉ chứa `.csv`. | **CLOSED (R2)** |
| `R2-F01` | R2 | P1 | `python-notebook-verifier.ts`: Sót `os.mkdir`/`os.makedirs` ngoài `sandboxDir` và còn `mmap`/`urllib`/`tempfile` trong `sys.modules` sau pre-warm `pandas` → Khóa `os.mkdir`/`os.makedirs` chỉ cho phép bên trong `sandbox_real` và dọn sạch toàn bộ prefix `BLOCKED_IMPORT_TOP` khỏi `sys.modules` trước khi gắn audit hook. | **CLOSED (R3)** |
| `R2-F02` | R2 | P1 | `grade-worker.ts`: `verifyBtns.nth(verifyBtnIdx).locator("..")` chỉ lấy thẻ bọc `<div class="mui-btn-wrapper">` (`innerText="Update"`) trên MUI thật làm Read-after-Write báo lỗi giả → Dùng thẳng `verifyCell` khi `verifyBtnCount <= 1` (100% bài Checkpoint), và đi ngược tối đa 3 cấp cha (`..`, `../..`, `../../..`) tìm khối chứa đúng `1` nút + khớp regex điểm khi `verifyBtnCount > 1`. | **CLOSED (R3)** |
| `R2-F03` | R2 | P2 | `rubric-ai/route.ts`: Ghi `datasetFile` ra đĩa trước khi kiểm tra hợp lệ `criteria`/`prompt` (để lại CSV mồ côi khi trả `400`) và cho phép trùng `criterionId` → Kiểm tra trùng `criterionId` (`seenCriterionIds` -> `400`), giữ `pendingDatasetWrite` trên RAM và chỉ ghi xuống đĩa sau khi toàn bộ Barem đã hợp lệ / AI sinh xong ngay trước `saveGradingRubrics`. | **CLOSED (R3)** |

---

## 2. Kết Quả Cổng Kiểm Thử & Probe Tấn Công Độc Lập Round 3

| STT | Hạng mục kiểm chứng | Kết quả | Chi tiết xác nhận |
|---:|---|---|---|
| 1 | `node .\node_modules\typescript\bin\tsc --noEmit --incremental false` | **PASS** (`exit 0`) | `0` lỗi kiểu TypeScript toàn dự án |
| 2 | `scripts/test-checkpoint-grader-v386.ts` (`$env:TEMP`) | **PASS** (`exit 0`) | `CPG-01..CPG-06` (phân giải cột CP, tải gói đa tệp & khóa `[MISSING_CODE_FILE]`, Python 3.12 sandbox & phát hiện `.ipynb` stale output, Barem 100 điểm, `#tabpanel-3` Read-after-Write, toàn bộ 18 hồi quy `F01..F15` + `R2-F01..R2-F03`) |
| 3 | Bộ kiểm thử hồi quy liên quan (`$env:TEMP`) | **PASS** (`exit 0`) | `test-homework-hide-scores-v369.ts`, `test-phase5.ts`, `test-lms-reliability-v280.ts`, `test-checkpoint-auto-v370.ts`, `test-streamline-v340-s4.ts`, `test-phase4-codex-repros.ts`, `test-report-card-v330.ts` |
| 4 | `R3-PROBE-1` (Python 3.12 Sandbox & `pandas`/`matplotlib`) | **PASS** | `PD_MAX: 22000`, `PLT_OK`, `LEAKED_MODS: 0`, `9/9` module cấm bị chặn re-import, `os.mkdir`/`os.makedirs` ngoài sandbox bị chặn `100%` |
| 5 | `R3-PROBE-2` (Atomic CSV & Duplicate `criterionId`) | **PASS** | Cả 2 request lỗi trả `HTTP 400`, `0` tệp CSV mồ côi trên đĩa |
| 6 | `R3-PROBE-3` (Headless Chromium `#tabpanel-3` MUI Wrapper + `<`/`>`) | **PASS** | Cell 2 bài bọc `<div class="mui-box"><button>Update</button></div>` + `ExpandMoreIcon -> ExpandLessIcon` + nhận xét chứa `<`/`>` đạt `verifiedCount: 1, failedCount: 0` |

---

## 3. Xác Minh Bảo Toàn Dữ Liệu Thật (`data/` SHA-256)

| Tệp dữ liệu thật | SHA-256 Baseline Round 1 | SHA-256 Final Round 3 | Đối chiếu |
|---|---|---|---|
| `data/mindx_bot.db` | `9DCB62242C955E724FD3AE984D3182DE6FD3BDA805B1AE475B87AD22C44C2EDC` | `9DCB62242C955E724FD3AE984D3182DE6FD3BDA805B1AE475B87AD22C44C2EDC` | **MATCH 100%** |
| `data/mindx_bot.db-wal` | `395675526C5E27C38902212E78946C6702463A93FB72E40B9F3922338201B53C` | `395675526C5E27C38902212E78946C6702463A93FB72E40B9F3922338201B53C` | **MATCH 100%** |
| `data/running_classes.json` | `FCBA555CBC9F75871AE6187F597E3884F3556EC2E3B77529E143D32C73D4BA40` | `FCBA555CBC9F75871AE6187F597E3884F3556EC2E3B77529E143D32C73D4BA40` | **MATCH 100%** |
| `data/config/lms_class_ids.json` | `AC93C6A821E9D6FA8B148E82EC1D56B5FFEB627EE300935DE97AE3A62F7FA188` | `AC93C6A821E9D6FA8B148E82EC1D56B5FFEB627EE300935DE97AE3A62F7FA188` | **MATCH 100%** |
