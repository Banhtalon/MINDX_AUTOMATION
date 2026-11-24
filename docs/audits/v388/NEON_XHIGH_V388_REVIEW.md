# BÁO CÁO KIỂM ĐỊNH ĐỘC LẬP ĐỢT 1 (`v3.8.8`) — PURE-NODE MINDX LMS READ CLIENT & VÁ 2 KẼ HỞ PII

- **Người kiểm định:** `Gemini 4 Neon (XHigh)` (`neon-xhigh-auditor`, Independent Code & Security Auditor)
- **Vòng kiểm định hiện tại:** **Round 3 (`24/11/2026`)** *(Round 1: `NO-GO` `F01`–`F08` → Round 2: `NO-GO` đóng `7/8`, phát sinh `R2-F01` → Round 3: **ĐÓNG TRỌN `9/9`**)*
- **Phạm vi:** Đợt 1 (`v3.8.8`) — Bỏ Playwright cho toàn bộ luồng **ĐỌC/QUÉT** MindX LMS bằng Node.js HTTP/GraphQL thuần (`LmsHttpClient`) kèm DNS vượt Cloudflare WARP, fallback Playwright an toàn, và vá 2 kẽ hở che SĐT/Email trong `pii-anonymizer.ts`.
- **Trạng thái nghiệm thu cuối cùng:** **`VERDICT: GO`**
- **Tổng hợp trạng thái phát hiện:** **ĐÃ ĐÓNG TRỌN `9/9`** (`F01`–`F08` + `R2-F01`) | **`0` P0 | `0` P1 | `0` P2 | `0` P3 đang mở**.

> **Tóm tắt ngắn gọn cho Owner (Round 3 — `VERDICT: GO`):**
> Đợt 1 (`v3.8.8`) đã vượt qua kiểm định độc lập toàn diện cả về bảo mật, tính toàn vẹn dữ liệu và tương thích ngược:
> - Toàn bộ luồng **đọc/quét** lớp học, buổi học, bảng điểm, bài nộp và quét Admin giờ chạy trực tiếp bằng mạng nội bộ siêu nhanh (không phải mở trình duyệt Chromium như trước), vượt được chặn DNS WARP mà vẫn giữ chặt kiểm tra chứng chỉ SSL.
> - **Không hề đụng 1 dòng** vào các luồng ghi bài lên MindX LMS hay Google Drive / Bảng điểm Demo.
> - Hai kẽ hở lọc SĐT/Email học sinh trước khi gửi AI đã được vá kín, vượt qua trọn `36/36` tình huống kiểm thử khó (kể cả cặp 2–3 SĐT liền nhau nối dấu `/`, `-` hoặc mã vùng `(+84)`, `(028)`) mà không che nhầm ngày tháng, điểm số, mã lớp hay tên tệp.
> - Toàn bộ `9/9` lỗi phát hiện trong 2 vòng kiểm định trước đều đã được đóng dứt điểm, mọi bộ kiểm thử tự động đều chạy xanh (`exit 0`) và giữ nguyên **100%** dữ liệu thật trong `data/`. **Đủ điều kiện phát hành và đồng bộ GitHub.**

---

## 1. Ma Trận Đóng Toàn Bộ Phát Hiện (`9/9 CLOSED`)

| Mã | Mức độ | Tệp liên quan | Tóm tắt bản vá & Bằng chứng xác minh độc lập (cô lập `os.tmpdir()`) | Trạng thái |
|---|---|---|---|---|
| `F01` | P1 | `src/lib/lms/lms-http-client.ts` | `doesTokenMatchExpectedUsername` ưu tiên kiểm duy nhất `jwtIdentity` trước metadata (chặn 100% JWT `ADMIN` trong tệp `TEACHER`); `READ_FIREBASE_IDB_SCRIPT` trả mảng đầy đủ & `selectBestFirebaseIdbCandidate` chọn đúng vai trò mục tiêu từ IndexedDB đa hàng (`R2-CHECK F01: PASS`). | **CLOSED** |
| `F02` | P1 | `src/lib/playwright/sync-class.ts` | `parseSlotOrClassDateToEndOfDayMs` xử lý chuẩn cả số lẫn chuỗi Epoch 10–13 chữ số; `fetchRunningClassesViaApi` giữ đúng lớp `FINISHED <= 7 ngày` dạng Epoch và chặn xóa trắng `running_classes.json` (lùi về Playwright) khi `RUNNING` rỗng (`total !== 0`) hoặc `FINISHED` lỗi (`R2-CHECK F02: PASS`). | **CLOSED** |
| `F03` | P1 | `src/lib/lms/lms-http-client.ts`, `src/lib/lms/lms-graphql-queries.ts` | `gql()` trả `{ status: 400, data, errors, rawJson }` khi Apollo trả `HTTP 400` chứa JSON `errors` để chuỗi fallback `SAFE`/`MINIMAL`/`LEGACY`/`class(id)` chạy thật; `LMS_GET_CLASS_BY_ID_SAFE_QUERY` có đủ `slots.index` và `commentByAreas.commentAreaId`, trích đủ `9/9 [ĐNL]` và đã kiểm chứng read-only qua schema sống `lms-api.mindx.edu.vn` (`HTTP 200`, `R2-CHECK F03: PASS`). | **CLOSED** |
| `F04` | P1 | `src/lib/lms/lms-http-client.ts`, `src/lib/security/secret-redactor.ts` | `gql()` chạy `redactErrorValue` đệ quy trên mọi trường `errors` & `rawJson.errors` ở HTTP 200/400 (0 rò JWT/`refresh_token`); `secret-redactor.ts` che sạch JSON `"authorization": "Bearer ..."` non-JWT và `?key=...` (`R2-CHECK F04: PASS`). | **CLOSED** |
| `F05` | P2 | `src/lib/admin-center/admin-lms-scanner.ts` | `scanAdminCenterClasses` tự động lùi về `runPlaywrightAdminBundle()` khi `fetchAdminLmsBundleViaNodeApi` trả `!stoppedEarly && discoveryComplete === false && discoveredClasses.length === 0`. | **CLOSED** |
| `F06` | P2 | `src/lib/ai/pii-anonymizer.ts` | Mở rộng `VN_PHONE_CANDIDATE_RE` che đủ cặp 2–3 SĐT nối `/`, `-` (`0912345678/0987654321`, `0912345678-0987654321`), ngoặc `(+84)`/`(028)`, `09 1234 5678`, giữ `0` false-positive trên `36/36` ca kiểm thử sức ép gồm ngày giờ, khoảng ngày, điểm số, IP, mã lớp, số đơn 14 chữ số, tên tệp timestamp (`R2-CHECK F06: PASS`). | **CLOSED** |
| `F07` | P2 | `src/lib/playwright/download-submissions.ts` | Nhánh `forceScrapeMatrix: false` chặn `Integrity Violation` khi sai `classId`/`classCode`; `QUEUE_STOPPED` trong vòng lặp tải từng học viên dừng tức thì ngay sau học viên #1 (`R2-CHECK F07: PASS`). | **CLOSED** |
| `F08` | P3 | `src/lib/config.ts`, `scripts/test-admin-center-v350.ts`, `src/lib/lms/lms-http-client.ts` | Khôi phục `MINDX_LMS_CLASS_IDS_PATH` trong `detectPreseededAdminTestEnv()`; `test-admin-center-v350.ts` PASS trọn `[AC-01..AC-13]` kể cả khi truyền sẵn `MINDX_LMS_TOKEN_DIR`; `fetchMindxResourceBuffer` trả `null` an toàn khi `Location` redirect hỏng; `writeCachedLmsToken` dùng hậu tố ngẫu nhiên `crypto.randomBytes(4)`. | **CLOSED** |
| `R2-F01` | P2 | `src/lib/admin-center/admin-lms-scanner.ts` (`L5446-L5491`), `scripts/test-lms-http-client-phase1.ts` (`[P1-07]`) | Đưa `runPlaywrightAdminBundle()` ra ngoài `try/catch` (`let apiBundle: AdminLmsFetchedBundle | null = null; ... lmsBundle = apiBundle ?? (await runPlaywrightAdminBundle());`). Xác nhận độc lập qua `R3-PROBE-1..3`: fallback Playwright Admin chạy **đúng `1` lần duy nhất** (`warnings === 1`) ở cả nhánh discovery rỗng HTTP 200 lẫn nhánh API throw, và **`0` lần** khi `QUEUE_STOPPED`. | **CLOSED** |

---

## 2. Xác Nhận Trọn Bộ Checklist (a)–(f) Sau Bản Vá Cuối (Round 3)

- **(a) Đúng phạm vi:** **PASS** — `git diff` xác nhận **0 dòng thay đổi** trên toàn bộ luồng GHI LMS (`save-comments.ts`, `grade-worker.ts`, `spck-uploader.ts`, `session14-eval-uploader.ts`) và luồng Google Drive / Demo Sheet (`spck-drive-uploader.ts`, `spck-demo-sheet.ts`).
- **(b) Mạng & SSL:** **PASS** — DNS authoritative vượt WARP (`115.84.177.33`, `115.84.182.199`, fallback IP `103.109.43.92` / `45.117.83.246`) giữ chặt TLS (`rejectUnauthorized: true`, `servername: parsed.hostname`), host allowlist + tối đa 3 redirects (xử lý sạch `Location` hỏng) + trần streaming `25MB`. Kiểm chứng read-only schema sống `lms-api.mindx.edu.vn` PASS `10/10` query chính + `LMS_GET_CLASS_BY_ID_SAFE_QUERY`.
- **(c) Xác thực & Bí mật:** **PASS** — Tách riêng `playwright-auth/lms_token_teacher.json` và `lms_token_admin.json` (được loại trừ bởi `.gitignore` `/playwright-auth/` và `.graphifyignore` `playwright-auth/`), đối chiếu chặt `jwtIdentity` + lọc đa hàng IndexedDB, tự gia hạn qua `securetoken.googleapis.com`, retry 401 đúng 1x refresh → 1x bootstrap, KHÔNG retry refresh/bootstrap khi gặp GraphQL `FORBIDDEN` thuần phân quyền, và `redactSecrets` + `gql()` che kín toàn bộ JWT / `Authorization` / `refresh_token` / `id_token` / `session` / `firebaseApiKey` / `key` ở cả HTTP 200/400/error.
- **(d) PII:** **PASS** — `createRosterNameScrubber` & `anonymizeSession14Text` đã bật `redactContactInfo: true`, vượt `36/36` ca sức ép SĐT/Email với `0` false-positive.
- **(e) Fail-safe & Tương thích ngược:** **PASS** — Fallback sang Playwright hoạt động chính xác đúng 1 lần khi API lỗi cấu trúc/mạng/discovery; `MINDX_LMS_API_READ=false` và `forcePlaywright: true` hoạt động; `QUEUE_STOPPED` dừng tức thì với `0` lệnh gọi Playwright trên mọi luồng (`syncClass`, `fetchRunningClasses`, `fetchClassDatesFromLms`, `resolveLmsClassId`, `scrapeClassScores`, `downloadLessonSubmissions`, `runBatchReportCardSync`, `scanAdminCenterClasses`, `admin-teaching-actions`); `scrape-scores.ts` giữ tách 2 `try/catch` (lỗi `S2-03`/`S2-05` không rơi về Playwright) và bọc `typeof` tương thích `node:vm`; `admin-lms-scanner.ts` / `admin-teaching-actions.ts` tương thích hook mock `test-admin-center-v350.ts`; `download-submissions.ts` tương thích mock `globalThis.fetch` của `test-checkpoint-grader-v386.ts` và xử lý an toàn `forceScrapeMatrix: false`.
- **(f) Kiểm thử tự chạy & Toàn vẹn dữ liệu thật:** **PASS** (xem mục 3 bên dưới).

---

## 3. Bằng Chứng Lệnh Kiểm Thử & Bảo Toàn `100%` SHA-256 (Sau Bản Vá Cuối)

### 3.1. Cổng kiểm thử độc lập Round 3
| Cổng kiểm thử | Lệnh chạy | Kết quả Round 3 |
|---|---|---|
| TypeScript Check | `node .\node_modules\typescript\bin\tsc --noEmit --incremental false` | **PASS (`exit 0`)** |
| Phase 1 Suite (`[P1-01]..[P1-07]`) | `node .\node_modules\tsx\dist\cli.mjs scripts/test-lms-http-client-phase1.ts` | **PASS (`exit 0`)** *(xác nhận `adminSessionEntries === 1`, `warnings.length === 1`)* |
| Admin Center v3.5.0 (`[AC-01..AC-13]`) | `node .\node_modules\tsx\dist\cli.mjs scripts/test-admin-center-v350.ts` *(với `MINDX_LMS_TOKEN_DIR` trỏ vào `TEMP`)* | **PASS (`exit 0`)** |
| Report Card v3.3.0 (`RC-01..06`, `S2-01..09`) | `node .\node_modules\tsx\dist\cli.mjs scripts/test-report-card-v330.ts` *(cô lập `MINDX_LMS_TOKEN_DIR`)* | **PASS (`exit 0`)** |
| Checkpoint Grader v3.8.6 (`[CPG-01..06]`) | `node .\node_modules\tsx\dist\cli.mjs scripts/test-checkpoint-grader-v386.ts` *(cô lập `MINDX_LMS_TOKEN_DIR`)* | **PASS (`exit 0`)** |
| Report Card Batch Sync (`BS-01..09`, Round 2) | `node .\node_modules\tsx\dist\cli.mjs scripts/test-report-card-batch-sync.ts` *(không đổi file sau Round 2)* | **PASS (`exit 0`)** |
| Round 3 Independent Probes (`R3-PROBE-1..3`) | Probe cô lập `os.tmpdir()` kiểm 3 nhánh `R2-F01` (GQL-200 fallback, network throw fallback, `QUEUE_STOPPED`) | **PASS (`3/3`: `r1Warnings=1, pwCalls=1`; `r2Warnings=1, pwCalls=1`; `QUEUE_STOPPED pwCalls=0`)** |

### 3.2. Đối chiếu `Get-FileHash` (SHA-256) trên `3/3` tệp dữ liệu thật `data/`
| Tệp dữ liệu thật | SHA-256 trước audit | SHA-256 sau Round 3 | Trạng thái |
|---|---|---|---|
| `data/mindx_bot.db` | `CE4B1EB24767DE60F8CC19DD8A7793B5C29B90A2774A13D0FDA51F422EFA2E4C` | `CE4B1EB24767DE60F8CC19DD8A7793B5C29B90A2774A13D0FDA51F422EFA2E4C` | **BẢO TOÀN 100%** |
| `data/running_classes.json` | `FCBA555CBC9F75871AE6187F597E3884F3556EC2E3B77529E143D32C73D4BA40` | `FCBA555CBC9F75871AE6187F597E3884F3556EC2E3B77529E143D32C73D4BA40` | **BẢO TOÀN 100%** |
| `data/config/lms_class_ids.json` | `AC93C6A821E9D6FA8B148E82EC1D56B5FFEB627EE300935DE97AE3A62F7FA188` | `AC93C6A821E9D6FA8B148E82EC1D56B5FFEB627EE300935DE97AE3A62F7FA188` | **BẢO TOÀN 100%** |

---

## 4. Kết Luận Nghiệm Thu

- **`VERDICT: GO`**
- Đợt 1 (`v3.8.8`) đạt đủ toàn bộ tiêu chuẩn bảo mật, toàn vẹn dữ liệu, hiệu năng và tương thích ngược với `0` phát hiện mở (`P0/P1/P2/P3`). Có thể tiến hành cập nhật tài liệu `PROJECT_STATE.md`, `CHANGELOG.md`, `MINDX_AUTOMATION_PLAN.md`, làm mới đồ thị `graphify update .` offline `--code-only`, và đồng bộ lên GitHub.
