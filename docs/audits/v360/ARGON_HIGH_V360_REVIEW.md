# BÁO CÁO NGHIỆM THU ĐỘC LẬP `v3.6.0` — ARGON HIGH (`Gemini 4 Argon (High)`, Round 1)

- **Ngày nghiệm thu:** `2026-11-18`
- **Phiên bản:** `v3.6.0` (Tinh Gọn 3-Chạm Trang Upload SPCK Buổi 12–13–14, Tự Động Tính 9 Ô Tròn `[ĐNL]` Từ Trung Bình Buổi Kiểm Tra, Xếp Hạng Giải Nhất/Nhì/Ba 3 Chữ Số Thập Phân, Tự Điền Ô `Summary` Vinh Danh Đầu Trang Buổi 14, Tách Gọn `.yyz` `> 15 MB` Lọc Khóa Bí Mật & Liên Hoàn LMS $\rightarrow$ Teaching `60%/80%/100%` + Phiếu Điểm Cuối Khóa)
- **Người kiểm định độc lập:** Subagent **`argon-auditor`** (`Gemini 4 Argon (High)`, chỉ đọc 100% trên mã nguồn `src/` và `scripts/`, chạy toàn bộ bộ kiểm thử đối kháng độc lập `ADV-01..ADV-08` trong thư mục tạm `os.tmpdir()` tự dọn sạch trong `finally`)
- **Kết luận cuối cùng (Round 1):** **`VERDICT: GO`** (`0` lỗi `P0`/`P1`/`P2`/`P3` mở; toàn bộ `5/5` phát hiện tích hợp `[B1]`..`[F3]` đã được đóng triệt để trước khi vào cổng kiểm định cuối)

---

## 1. Kết Quả Soát Lỗi Chuyên Sâu Mức Dòng Lệnh (3 Trụ Cột Kiểm Định)

### 1.1. Vệ Sinh Cây Thư Mục, Bảo Mật Cục Bộ & Khóa PII (`AGENTS.md` Rule 2 & 5)
1. **Dọn sạch route khảo sát tạm:** Xác nhận thư mục tạm `src/app/api/spck/session14-live-ops/` đã được xóa hoàn toàn (`existsSync === false`), không có tệp rác hay khóa bí mật nào lọt vào cây thư mục.
2. **Bảo vệ API Local-Only (`validateLocalRequest`) & Path Allowlist (`assertPathAllowed`):**
   - Toàn bộ 9 route API cập nhật trong `v3.6.0` (`/api/spck/{scan,generate-ai,upload-drive,deploy-web,student-portal}`, `/api/spck/session14-eval`, `/api/spck/session14-eval/{import-demo-scores,generate-ai,upload-lms}`) đều kiểm tra `const guard = validateLocalRequest(req); if (guard) return guard;` ngay dòng đầu tiên của mọi handler `GET`/`POST`.
   - Mọi thao tác đọc/ghi tệp trên ổ đĩa trong `spck-scanner.ts` (`buildTrimmedLmsZipForOversizedArchive`, `extractRealProjectTopicTitle`, `inspectStudentProjectCodeSignals`, `resolveTempSubmissionsTrimRoot`) và `spck-demo-score-reader.ts` (`resolveDefaultDemoSheetPathForClass`, `loadXlsxBufferFromSource`) đều đi qua `assertPathAllowed` và kiểm tra `lstatSync().isSymbolicLink()`.
3. **An toàn gói `.zip` rút gọn cho `.yyz`/`.zip` `> 15 MB` (`buildTrimmedLmsZipForOversizedArchive`):**
   - Chặn tuyệt đối đường dẫn Zip-Slip (`..`, đường dẫn tuyệt đối, ổ đĩa Windows, NUL byte), chặn symlink Unix (`(attr >>> 16) & 0o170000 === 0o120000`), chặn độ sâu `> 10` cấp, chặn toàn bộ phần mở rộng thực thi nguy hiểm (`.exe`, `.bat`, `.cmd`, `.msi`, `.ps1`, `.vbs`, `.scr`, `.com`, `.dll`, `.pif`, `.jar`).
   - Lọc sạch tệp nhạy cảm ở cả 2 lượt (theo tên tệp/dotfile và theo nội dung buffer `isSensitiveSecretFile(base, data)`): chặn `.env`, `.env.*`, `.npmrc`, `.netrc`, `.pypirc`, `.htpasswd`, `.git-credentials`, `*.pem|*.key|*.pfx|*.p12|*.jks|*.keystore|*.kdbx|*.ovpn`, `id_rsa|id_dsa|id_ecdsa|id_ed25519` (kể cả `.pub`), `credentials|secrets|tokens|service-account*|firebase-adminsdk*.json`, khối `-----BEGIN ... PRIVATE KEY-----` ẩn trong tệp văn bản bất kỳ và các khóa JSON nhạy cảm (`client_secret`, `gemini_api_key`, `lms_password`, `teaching_password`, `refresh_token`).
   - Giữ nguyên 100% tệp `.yyz` gốc đầy đủ trong thư mục học viên để đóng gói lên Google Drive (`zip_bundle`), đồng thời ưu tiên tệp `.yyz` có `mtime` mới nhất khi thư mục học viên có nhiều bản `.yyz`.
4. **Khóa PII (`STUDENT_XX`) & Cô lập Client (`'use client'`):**
   - Trong `session14-course-summary.ts` và `spck-comment.ts`: toàn bộ tên học viên mục tiêu, tên gọi ngắn, tên bạn cùng lớp (`peerNames`) và ghi chú BGK (`demoJudgeNote`) đều được ẩn danh triệt để trước khi gọi Gemini; cả nhánh lỗi `catch (err)` cũng gán `outboundPromptSample: safePrompt` (`0` PII rò rỉ).
   - Toàn bộ các tệp Client (`src/app/final-project/page.tsx`, `src/components/final-project/*.tsx`, `src/components/final-project/useSpckWorkflow.ts`, `src/lib/spck/spck-ui-helpers.ts`, `src/components/top-navbar.tsx`) không tham chiếu biến môi trường nhạy cảm (`TEACHING_PASSWORD`, `LMS_PASSWORD`, `GEMINI_API_KEY`) hay module chỉ dành cho server.

### 1.2. Độ Chính Xác Toán Học & Logic Tự Động Hóa Buổi 14
1. **Đồng bộ 100% thứ tự `DOM[0..8]` của 9 ô tròn Điểm Năng Lực `[ĐNL]`:**
   - Khớp chính xác thứ tự thực tế trên Modal Cột 2 của MindX LMS giữa `SESSION14_COMPETENCY_AREA_SPECS`, `SESSION14_COMPETENCY_KEYS` (`sqlite.ts`), `COMPETENCY_ITEMS_UI` (`spck-ui-helpers.ts`) và vòng lặp tích radio `groupIdx * 5 + (rating - 1)` trong `Session14EvalUploader`:
     - `DOM[0]`: `knowledgeSelfStudy` (`665e7d33181e0e47f6c63768` — `[ĐNL] Kiến thức học viên tự học`)
     - `DOM[1]`: `knowledgeInClass` (`668d69d8e71f90e7630ce16c` — `[ĐNL] Kiến thức học viên đã được học tại lớp`)
     - `DOM[2]`: `skillCommunication` (`4316`), `DOM[3]`: `skillComputerUse` (`406f`), `DOM[4]`: `skillProblemSolving` (`2db6`), `DOM[5]`: `skillCreativity` (`e198`), `DOM[6]`: `skillComputational` (`e187`), `DOM[7]`: `attitudeHomework` (`44c1`), `DOM[8]`: `attitudeInClass` (`434f`).
   - Tự động chọn đúng **Buổi 5 & Buổi 9** cho các lớp Lập trình và **Buổi 4 & Buổi 8** cho các lớp Robotics (`isRoboticsClassCode`).
   - Xử lý chính xác mảng `commentByAreas` bị đảo vị trí hoặc lẫn mục `TEXT`, học viên khuyết 1 ô `RATE` ở 1 buổi (`26/8 = 3.25` kế thừa đúng tiêu chí từ buổi kia mà không trượt cột), học viên vắng 1 buổi kiểm tra, và thuật toán làm tròn luân phiên `.5` chọn `bestK` tối thiểu hóa `|sum(r)/9 - targetAvg|` ưu tiên tiêu chí tiến bộ `CP2 > CP1`.
2. **Xếp hạng Giải Nhất – Nhì – Ba 3 chữ số thập phân (`3dp`) & Ô `Summary` đầu trang Buổi 14:**
   - `computeSession14AwardRankingsPure` phân hạng trên tổng điểm gốc `3dp` (`SUM(E8:E27)` như `4.250`, `4.125`, `3.880` vs `3.875`) trước khi LMS làm tròn `2dp`, hỗ trợ đầy đủ `Giải Nhất` / `Đồng Giải Nhất`, `Giải Nhì` / `Đồng Giải Nhì`, `Giải Ba` / `Đồng Giải Ba`, và tách biệt học viên hạng 4+ (`COMPLETED` — không gắn nhầm huy hiệu giải thưởng trên dòng học viên nhờ bộ lọc trong `resolveStudentAwardLabel`) cũng như loại học viên nghỉ học (`isActive = 0`).
   - Lớp Lập trình (`JSB`, `GA`, `PTA`, `CSI`...) giữ `awardRanking = ""` để khớp đúng 3 ô `.ql-editor` trên LMS; chỉ lớp Robotics mới điền danh hiệu vào ô `.ql-editor` thứ 4.
   - `Session14EvalUploader.uploadAndVerifySlot14ClassSummary` đảm bảo checkbox đầu trang `input[type="checkbox"][id="13"]` luôn giữ **`checked === false`**, điền HTML vào `.ql-editor` của khung `Summary`, giữ focus chờ đúng GraphQL `mutation UpdateSlotComment` trả về `HTTP 200` (fail-closed nếu HTTP 500 hoặc GraphQL trả về `errors`), và đối chiếu Read-after-Write trên DOM trước khi đánh dấu `VERIFIED`.

### 1.3. An Toàn Đa Luồng & Giao Diện 3-Chạm (`/final-project`)
1. **Tinh gọn 3 Nút Cố Định (`1. Đồng bộ bài làm` $\rightarrow$ `2. AI Soạn nhận xét` $\rightarrow$ `3. Duyệt & Nộp tất cả`):**
   - Nút `1. Đồng bộ bài làm`: tự động đóng Cổng thu bài học sinh trước nếu đang mở, sau đó chạy tuần tự Quét thư mục $\rightarrow$ Chụp ảnh `16:9` $\rightarrow$ Đẩy GitHub Pages (bỏ qua `< 10ms` học viên không đổi bài, đặt `GCM_INTERACTIVE=never` & `GIT_TERMINAL_PROMPT=0`, bỏ qua `git commit/push` khi `git status --porcelain` rỗng) $\rightarrow$ Đẩy Google Drive (bỏ qua `< 10ms` học viên không đổi bài) $\rightarrow$ Nạp Điểm Demo BGK + `[ĐNL]` TB B5+9 ở Buổi 14.
   - Nút `2. AI Soạn nhận xét`: tự nâng cấp tên mặc định `"SPCK <Tên>"` sang `<Tên Đề Tài> - <Họ Tên>` (`<= 100` ký tự), tự gợi ý Quick Tags cho cả `CSA`/`CSI` và gắn thẻ thuyết trình Buổi 14 theo điểm `communication` BGK, đồng thời mở khung xem trước/chỉnh sửa nhanh bài `Summary` vinh danh Nhất/Nhì/Ba ở Buổi 14.
   - Nút `3. Duyệt & Nộp tất cả`: không chặn cả lớp khi có 1–2 học viên vắng hoặc thiếu bài/điểm (nộp trước các học viên đủ điều kiện và gắn nhãn cảnh báo đỏ chờ nộp bù sau); tự động chạy nối tiếp cập nhật Tiến độ dự án Teaching (`60%` ở B12, `80%` ở B13, `100%` + Quét & Đồng bộ Phiếu điểm cuối khóa ở B14) và cô lập lỗi mạng Teaching phụ thành cảnh báo mà không làm mất trạng thái `VERIFIED` của LMS.
   - Cập nhật đồng bộ `lastServerSnapshots` trong `useSpckWorkflow.ts` giúp Bước 3 ở Buổi 14 không gọi thừa `save_draft` khi giáo viên không sửa tay và nâng ngưỡng chờ flush lên `5000ms`.
   - Bảo toàn 100% tương thích ngược với harness `docs/audits/round-38/adversarial.mjs` và khóa `0` idle polling khi Cổng thu bài tắt.

---

## 2. Ma Trận Kiểm Thử Thực Thi Độc Lập

Toàn bộ các cổng kiểm thử và bộ probe đối kháng độc lập đều đạt **`PASS (exit 0)`**:

| STT | Cổng kiểm thử / Lệnh thực thi | Kết quả | Chi tiết xác minh |
| :---: | :--- | :---: | :--- |
| 1 | `node .\node_modules\typescript\bin\tsc --noEmit --incremental false` | **PASS (`exit 0`)** | `0` lỗi kiểu TypeScript trên toàn dự án |
| 2 | Bộ Probe Đối Kháng Độc Lập `ADV-01`..`ADV-08` (chạy trong `os.tmpdir()`) | **PASS (`exit 0` — `8/8`)** | `ADV-01` hoán vị/nhiễu `commentByAreas` & `.5` tie-break; `ADV-02` đồng hạng 3dp, lọc `COMPLETED` & chống XSS `Summary`; `ADV-03` chặn symlink `0o120000`, lọc khóa PEM/JSON ẩn & cắt gọn multi-WAV `56MB -> <48MB`; `ADV-04` chống rò rỉ PII cả nhánh lỗi `outboundPromptSample`; `ADV-05` fail-closed khi DOM `Summary` lệch Read-after-Write; `ADV-06` đổi 1 byte vô hiệu hóa fast-skip; `ADV-07` lọc `<title>Document</title>` & biên thẻ thuyết trình; `ADV-08` khớp thang điểm Demo UI vs DB trên 9 mã khóa |
| 3 | `node .\node_modules\tsx\dist\cli.mjs scripts/test-spck-v360.ts` | **PASS (`exit 0` — `5/5`)** | Toàn bộ 5 nhóm `V360-01`..`V360-05` + Chromium E2E 3-Chạm + Round-38 VM Harness |
| 4 | `node .\node_modules\tsx\dist\cli.mjs scripts/test-spck-streamlined-v355.ts` | **PASS (`exit 0` — `5/5`)** | Hồi quy `R355-01`..`R355-05` |
| 5 | `node .\node_modules\tsx\dist\cli.mjs scripts/test-drive-tray-and-autoprep-v354.ts` | **PASS (`exit 0` — `6/6`)** | Hồi quy `R354-01`..`R354-06` |
| 6 | `node .\node_modules\tsx\dist\cli.mjs scripts/test-spck-reupload-v353.ts` | **PASS (`exit 0` — `4/4`)** | Hồi quy `R353-01`..`R353-04` |
| 7 | `node .\node_modules\tsx\dist\cli.mjs scripts/test-session14-v290.ts` | **PASS (`exit 0` — `7/7`)** | Hồi quy `S14-01`..`S14-07` (`F01`..`F12`) |

---

## 3. Bảo Toàn Dữ Liệu Thật 100% (Live Data SHA-256 Verification)

Đối chiếu SHA-256 trước và sau toàn bộ quá trình kiểm định độc lập — **khớp `100%` từng byte so với baseline**:

- `data/mindx_bot.db`: `D4AAA6428F83F601BC1C196DBE4164673CB227B3B813DD08FBE85EFC949FA5F7` (**MATCH 100%**)
- `data/mindx_bot.db-wal`: `3B12A042A4E499D431708F124563B431A989CC8D88A3F6A69888C7DC4030F5AF` (**MATCH 100%**)
- `data/running_classes.json`: `347B60EB0BB29BA6863C75B550F14F331B7D48C141482B08B924D26BFD80DC73` (**MATCH 100%**)
- `data/config/lms_class_ids.json`: `0C90FA3EBF2B56746D07807202A8AD1EFA2B68818182D740B2DFB2D21E6A9D2A` (**MATCH 100%**)

---

## 4. Tổng Hợp Phát Hiện & Phán Quyết Nghiệm Thu

- **P0 (Nghiêm trọng):** `0` mở (`None`)
- **P1 (Cao):** `0` mở (`None`)
- **P2 (Trung bình):** `0` mở (`None`)
- **P3 (Nhỏ / Lưu ý):** `0` mở (`None`)

**PHÁN QUYẾT CUỐI CÙNG: `VERDICT: GO`**
