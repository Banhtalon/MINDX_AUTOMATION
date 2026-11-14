# Round 5 — Final Closing Verification

MINDX-AUTOMATION Phase 12, v3.5.0, `/admin-center`, cơ sở `205ALHP`.
Ngày kiểm định: **14/11/2026**. Vai trò: kiểm định bảo mật và độ tin cậy độc lập, chỉ đọc mã sản phẩm.

## Tóm tắt điều hành và kết luận cuối (Executive Summary & Final Verdict)

**VERDICT: GO** — đủ điều kiện đóng Round 5 trong phạm vi **kiểm định ngoại tuyến của bản staging hiện tại**.

Đã đối chiếu đủ **25/25 ID: CLOSED**, gồm Round 1 #1..#15, Round 2 R2-01..R2-07, Round 3 R3-01..R3-03. **0 OPEN, 0 PARTIAL; không còn P0/P1/P2/P3 mở trong phạm vi các phát hiện và ca đã kiểm.** Hai cổng bắt buộc đều exit 0; bộ độc lập **119/119 PASS, 0 FAIL** (vượt yêu cầu 71+); tự kiểm hàng rào **14/14 PASS**. Staging **192/192 tệp giữ nguyên SHA-256**, không thêm/xóa/đổi tệp hoặc thư mục.

Ba việc còn lại của Round 4 đều đã đóng: tổng SPCK được so trực tiếp khi chưa làm tròn; AC-08 có đủ 12 tổ hợp thao tác/lỗi; ba tài liệu đã đồng bộ đúng DB tạm, nhóm kiểm thử và ranh giới nghiệm thu. GO này không xác nhận đăng nhập SSO hoặc đọc/ghi LMS/Teaching thật, không chứng nhận triển khai production.

## Phạm vi, nguồn và phương pháp

- Staging chỉ đọc: `C:\Users\QQ\AppData\Local\Temp\mindx-v350-codex-audit`.
- Tất cả script, stdout/stderr, receipt, DB SQLite, hồ sơ/tệp tạm Chromium, bundle React, ảnh và báo cáo: `C:\Users\QQ\AppData\Local\Temp\mindx-v350-round5-meta`.
- Đã đọc Round 1–4 và `prior_audits/ROUND4_INDEPENDENT_RESULTS.json`; Round 4 ghi 71 ca/67 PASS/4 FAIL. Không dùng các kết quả cũ thay cho lần chạy mới. Báo cáo Round 4 còn các chỗ chờ điền; báo cáo này nhúng trực tiếp kết quả đã quan sát.
- Đã đọc PROJECT_STATE trước, đối chiếu toàn bộ vùng v3.5.0 của CHANGELOG và Phase12 của kế hoạch, cùng Mục 2 và Mục 5 của PROJECT_STATE. Đối chiếu các nhánh auth/che bí mật, API, scanner/Teaching, SQLite Admin, hàng đợi và giao diện liên quan 25 ID.
- Bản staging không có `.git` hoặc `graphify-out/graph.json`. Không tạo đồ thị, sửa mã, cập nhật tài liệu sản phẩm, commit/push hay truy cập GitHub. Kết quả gắn với SHA-256, không tự gán cho một commit/HEAD chưa xác minh.
- Giả định một máy giáo viên, có thể gửi nhiều yêu cầu gần nhau; mọi tác vụ trình duyệt sản phẩm chạy qua một hàng đợi. Dữ liệu và tài khoản trong bài thử đều là giả lập.
- Bộ độc lập nhập mã sản phẩm hiện tại và chạy SQLite tệp thật trong meta; giả lập nơi gửi/nhận Teaching và GraphQL. Chỉ tái sử dụng hàm **tạo dữ liệu mẫu** `makeCodingClassByIdGql` của suite; không tái sử dụng các assertion/kết luận của suite. JSON helper được trích nguyên từ nguồn hiện tại rồi biên dịch trong bộ nhớ để kiểm chính mã đang bàn giao.
- Giao diện React thật được đóng gói vào meta, phục vụ bằng HTTP loopback và thao tác bằng Chromium headless. Có 12 ảnh và nội dung DOM lưu kèm. Đã xem ảnh ca JSON hỏng/SPCK: có thông báo không hoàn tất. Bộ dựng thử không nạp toàn bộ CSS ứng dụng; đây là kiểm hành vi, không phải nghiệm thu thẩm mỹ/di động.

## Lệnh đã chạy và đầu ra thực tế (Verification Commands Run & Actual Outputs)

Mọi cổng chạy với thư mục hiện hành là staging. `run.py` đặt `npm_config_offline=true`, npm cache/TEMP/TMP/TMPDIR vào meta, `NODE_OPTIONS=--require=.../offline.cjs`, `TSX_DISABLE_CACHE=1`, tắt tải Chromium/telemetry và loại thông tin đăng nhập kế thừa khỏi môi trường trước khi nạp fixture. Bốn biến `MINDX_DB_PATH`, `MINDX_CONFIG_DIR`, `MINDX_TEMP_DIR`, `MINDX_ROLE_STATE_DIR` đều vào meta **trước khi nhập config/SQLite**. Running-classes và LMS-class-IDs giả cũng nằm trong meta. Suite tự đặt lại DB/config/role vào thư mục `mkdtempSync(os.tmpdir())`, mà os.tmpdir đã được chuyển vào meta.

| Cổng | Lệnh thực tế trên Windows | Exit | Thời gian |
|---|---|---:|---:|
| tsc-final | `npx.cmd tsc --noEmit --incremental false` | 0 | 1.435 giây |
| suite-confirmed | `npx.cmd tsx scripts/test-admin-center-v350.ts` | 0 | 22.418 giây |
| independent-final | `npx.cmd tsx C:\Users\QQ\AppData\Local\Temp\mindx-v350-round5-meta\independent.cjs` | 0 | 10.074 giây |
| guard-final | `node C:\Users\QQ\AppData\Local\Temp\mindx-v350-round5-meta\guard-selftest.cjs` | 0 | 0.058 giây |

Lệnh bao ngoài đã dùng (đường dẫn tuyệt đối, không cần cài thư viện):

```powershell
python "C:\Users\QQ\AppData\Local\Temp\mindx-v350-round5-meta\run.py" tsc-final npx.cmd tsc --noEmit --incremental false
python "C:\Users\QQ\AppData\Local\Temp\mindx-v350-round5-meta\run.py" suite-confirmed npx.cmd tsx scripts/test-admin-center-v350.ts
python "C:\Users\QQ\AppData\Local\Temp\mindx-v350-round5-meta\run.py" independent-final npx.cmd tsx C:\Users\QQ\AppData\Local\Temp\mindx-v350-round5-meta\independent.cjs
python "C:\Users\QQ\AppData\Local\Temp\mindx-v350-round5-meta\run.py" guard-final node C:\Users\QQ\AppData\Local\Temp\mindx-v350-round5-meta\guard-selftest.cjs
```

### npx tsc --noEmit --incremental false

Receipt: `tsc-final-receipt.json`. **Exit 0**.

Nguyên văn stdout:

```text
(không có đầu ra)
```

Nguyên văn stderr:

```text
(không có đầu ra)
```

### npx tsx scripts/test-admin-center-v350.ts

Receipt: `suite-confirmed-receipt.json`. **Exit 0**.

Nguyên văn stdout:

```text
PASS [AC-01] Secret redaction & session milestone parity
PASS [AC-02] Role-aware MindX cookie isolation & unconditional Teacher restore
PASS [AC-03/04] DB/JSON isolation, Teaching scrapers & Audits Tabs 1-5
PASS [AC-05] Coding BTVN sync Read-after-Write + Robotics guard
PASS [AC-06] > Session 9 SPCK provisioning + non-downgrading Math.max progress
PASS [AC-07] 403 local-only guard, single BrowserContext & client isolation
PASS [AC-08] Headless UI smoke, error banners (ADV-15..17) & zero idle polling
PASS [AC-09] All 20 Codex Adversarial Scenarios (ADV-01..ADV-20)
PASS [AC-10] All 7 Codex Round 2 Scenarios (R2-01..R2-07)
PASS [AC-11] Codex Round 3 Closure (#8 Fractional Weight, R3-01 Strict JSON UI, R3-02 Unique RunId)
ALL ADMIN CENTER V3.5.0 TESTS PASSED
```

Nguyên văn stderr:

```text
◇ injected env (0) from .env.local
◇ injected env (0) from .env
[AuthService.withAdminLmsSession] [Auth Restore Error] Khôi phục phiên LMS Giáo viên thất bại: Danh tính LMS sau khôi phục là "<chưa xác định>", không khớp phiên Giáo viên ("teacher_test@mindx.edu.vn").
[AuthService.withAdminLmsSession] [Auth Restore Error] Khôi phục phiên LMS Giáo viên thất bại: Cookie jar locked
[AuthService.withAdminLmsSession] [Auth Restore Error] Khôi phục phiên LMS Giáo viên thất bại: Danh tính LMS sau khôi phục là "wrong_user@mindx.net.vn", không khớp phiên Giáo viên ("teacher_test@mindx.edu.vn").
```

### npx tsx C:\Users\QQ\AppData\Local\Temp\mindx-v350-round5-meta\independent.cjs

Receipt: `independent-final-receipt.json`. **Exit 0**.

Nguyên văn stdout:

```text
PASS SEED-healthy-scan {"status":"COMPLETED","gradedCells":6}
PASS AUTH-unknown-admin {"workCalls":0,"restoreCalls":1,"rejected":true}
PASS AUTH-wrong-admin {"workCalls":0,"restoreCalls":1,"rejected":true}
PASS AUTH-restore-unknown {"workCalls":1,"restoreCalls":1,"rejected":true}
PASS AUTH-restore-error {"workCalls":1,"restoreCalls":1,"rejected":true}
PASS AUTH-callback-error {"workCalls":1,"restoreCalls":1,"rejected":true}
PASS SECRET-public-redaction {"secretsTested":4,"bearerRemoved":true,"publicConfigSafe":true}
PASS DATE-wrong-"1999-01-01" {"date":"1999-01-01","lms":"Chưa xác minh","zalo":"Chưa xác minh"}
PASS DATE-wrong-"2026-12-10" {"date":"2026-12-10","lms":"Chưa xác minh","zalo":"Chưa xác minh"}
PASS DATE-wrong-"" {"date":"","lms":"Chưa xác minh","zalo":"Chưa xác minh"}
PASS DATE-wrong-"bad-date" {"date":"bad-date","lms":"Chưa xác minh","zalo":"Chưa xác minh"}
PASS DATE-UTC7-rollover {"date":"2026-12-17","lms":"Đã hoàn thành","zalo":"Đã hoàn thành"}
PASS BTVN-ungraded-independent-of-graded {"ungraded":1,"graded":5}
PASS ELIGIBILITY-session-0 {"http":400,"writes":0}
PASS ELIGIBILITY-session-1 {"http":400,"writes":0}
PASS ELIGIBILITY-session-9 {"http":400,"writes":0}
PASS W-fractional {"weights":[20,20,20,20,20,0.1],"rawTotal":100.1,"reportedTotal":100.1,"evaluator":"INCOMPLETE_TASKS","http":409,"provision":"NEEDS_ATTENTION","dbStatus":"INCOMPLETE","deletes":0,"writes":5,"extraUnchanged":true}
PASS W-negative {"weights":[20,20,20,20,20,-0.1],"rawTotal":99.9,"reportedTotal":100,"evaluator":"INCOMPLETE_TASKS","http":409,"provision":"NEEDS_ATTENTION","dbStatus":"INCOMPLETE","deletes":0,"writes":5,"extraUnchanged":true}
PASS W-NaN {"weights":[20,20,20,20,20,null],"rawTotal":null,"reportedTotal":100,"evaluator":"INCOMPLETE_TASKS","http":409,"provision":"NEEDS_ATTENTION","dbStatus":"INCOMPLETE","deletes":0,"writes":5,"extraUnchanged":true}
PASS W-Infinity {"weights":[20,20,20,20,20,null],"rawTotal":null,"reportedTotal":100,"evaluator":"INCOMPLETE_TASKS","http":409,"provision":"NEEDS_ATTENTION","dbStatus":"INCOMPLETE","deletes":0,"writes":5,"extraUnchanged":true}
PASS W-invalid-string {"weights":[20,20,20,20,20,"invalid"],"rawTotal":null,"reportedTotal":100,"evaluator":"INCOMPLETE_TASKS","http":409,"provision":"NEEDS_ATTENTION","dbStatus":"INCOMPLETE","deletes":0,"writes":5,"extraUnchanged":true}
PASS W-zero-control {"weights":[20,20,20,20,20,0],"rawTotal":100,"reportedTotal":100,"evaluator":"READY","http":200,"provision":"VERIFIED","dbStatus":"VERIFIED","deletes":0,"writes":5,"extraUnchanged":true}
PASS W-near-threshold {"weights":[20,20,20,20,20,6e-7,6e-7],"rawTotal":100.00000120000001,"reportedTotal":100.00000120000001,"evaluator":"INCOMPLETE_TASKS","http":409,"provision":"NEEDS_ATTENTION","dbStatus":"INCOMPLETE","deletes":0,"writes":5,"extraUnchanged":true}
PASS JSON-empty {"ok":false,"invalidJson":false}
PASS JSON-malformed {"ok":false,"invalidJson":true}
PASS JSON-array {"ok":false,"invalidJson":true}
PASS JSON-null {"ok":false,"invalidJson":true}
PASS JSON-number {"ok":false,"invalidJson":true}
PASS JSON-string {"ok":false,"invalidJson":true}
PASS JSON-boolean {"ok":false,"invalidJson":true}
PASS JSON-false {"ok":false,"invalidJson":false}
PASS JSON-truthy-string {"ok":false,"invalidJson":false}
PASS JSON-http500 {"ok":false,"invalidJson":false}
PASS JSON-http201 {"ok":true,"invalidJson":false}
PASS JSON-http200 {"ok":true,"invalidJson":false}
PASS JSON-eight-fetch-handlers [{"line":143,"strictHelper":true},{"line":214,"strictHelper":true},{"line":266,"strictHelper":true},{"line":303,"strictHelper":true},{"line":341,"strictHelper":true},{"line":388,"strictHelper":true},{"line":444,"strictHelper":true},{"line":491,"strictHelper":true}]
PASS BODY-scan-"" {"http":400}
PASS BODY-scan-"{" {"http":400}
PASS BODY-scan-"[]" {"http":400}
PASS BODY-scan-"null" {"http":400}
PASS BODY-scan-"{}" {"http":400}
PASS BODY-scan-"true" {"http":400}
PASS BODY-scan-"\"x\"" {"http":400}
PASS BODY-scan-"0" {"http":400}
PASS BODY-scan-" " {"http":400}
PASS BODY-sync-btvn-"" {"http":400}
PASS BODY-sync-btvn-"{" {"http":400}
PASS BODY-sync-btvn-"[]" {"http":400}
PASS BODY-sync-btvn-"null" {"http":400}
PASS BODY-sync-btvn-"{}" {"http":400}
PASS BODY-sync-btvn-"true" {"http":400}
PASS BODY-sync-btvn-"\"x\"" {"http":400}
PASS BODY-sync-btvn-"0" {"http":400}
PASS BODY-sync-btvn-" " {"http":400}
PASS BODY-provision-spck-tasks-"" {"http":400}
PASS BODY-provision-spck-tasks-"{" {"http":400}
PASS BODY-provision-spck-tasks-"[]" {"http":400}
PASS BODY-provision-spck-tasks-"null" {"http":400}
PASS BODY-provision-spck-tasks-"{}" {"http":400}
PASS BODY-provision-spck-tasks-"true" {"http":400}
PASS BODY-provision-spck-tasks-"\"x\"" {"http":400}
PASS BODY-provision-spck-tasks-"0" {"http":400}
PASS BODY-provision-spck-tasks-" " {"http":400}
PASS LOCAL-remote-url {"http":403}
PASS LOCAL-remote-host {"http":403}
PASS LOCAL-remote-origin {"http":403}
PASS LOCAL-cross-site {"http":403}
PASS PATH-allowlist {"allowedMeta":true,"systemDenied":true,"traversalDenied":true}
PASS SCOPE-BTVN-empty {"http":400,"writes":0}
PASS SCOPE-SPCK-empty {"http":400,"writes":0}
PASS SCOPE-BTVN-invalid {"http":400,"writes":0}
PASS SCOPE-SPCK-invalid {"http":400,"writes":0}
PASS SCOPE-BTVN-mixed {"http":400,"writes":0}
PASS SCOPE-SPCK-mixed {"http":400,"writes":0}
PASS SCOPE-BTVN-object {"http":400,"writes":0}
PASS SCOPE-SPCK-object {"http":400,"writes":0}
PASS SCOPE-BTVN-null {"http":400,"writes":0}
PASS SCOPE-SPCK-null {"http":400,"writes":0}
PASS LOCK-db-busy-retry {"retry":"COMPLETED","locked":false}
PASS RUNID-fixed-stop-resume {"stopped":"STOPPED","resumed":"COMPLETED","first":"admin_scan_1794680000000_fd6e84b3","second":"admin_scan_1794680000000_d2d388ac"}
PASS IDENTITY-wrong-id {"rejected":true}
PASS IDENTITY-wrong-code {"rejected":true}
PASS DISCOVERY-partial-keeps-old {"status":"PARTIAL","kept":true}
PASS GQL-submissions-http-errors {"endpoint":"submissions","mode":"http-errors","rejected":true}
PASS GQL-submissions-http-data {"endpoint":"submissions","mode":"http-data","rejected":true}
PASS GQL-submissions-gql-errors {"endpoint":"submissions","mode":"gql-errors","rejected":true}
PASS GQL-works-http-errors {"endpoint":"works","mode":"http-errors","rejected":true}
PASS GQL-works-http-data {"endpoint":"works","mode":"http-data","rejected":true}
PASS GQL-works-gql-errors {"endpoint":"works","mode":"gql-errors","rejected":true}
PASS GQL-class-http-errors {"endpoint":"class","mode":"http-errors","rejected":true}
PASS GQL-class-http-data {"endpoint":"class","mode":"http-data","rejected":true}
PASS GQL-class-gql-errors {"endpoint":"class","mode":"gql-errors","rejected":true}
PASS CACHE-subError {"status":"PARTIAL","success":false,"cachePreserved":true}
PASS CACHE-worksError {"status":"PARTIAL","success":false,"cachePreserved":true}
PASS CACHE-error {"status":"PARTIAL","success":false,"cachePreserved":true}
PASS ROSTER-zero-students {"mismatch":true}
PASS ROSTER-failed-endpoint {"mismatch":false}
PASS S14-missing-0-criteria {"missing":2,"criteria":0}
PASS S14-missing-8-criteria {"missing":2,"criteria":8}
PASS DOC-PROJECT_STATE.md {"noMemoryMismatch":true,"AC11":true,"DB":"mindx_admin_test.db / os.tmpdir()","documentationSeparated":true,"suiteMentions":3}
PASS DOC-CHANGELOG.md {"noMemoryMismatch":true,"AC11":true,"DB":"mindx_admin_test.db / os.tmpdir()","documentationSeparated":true,"suiteMentions":1}
PASS DOC-MINDX_AUTOMATION_PLAN.md {"noMemoryMismatch":true,"AC11":true,"DB":"mindx_admin_test.db / os.tmpdir()","documentationSeparated":true,"suiteMentions":2}
PASS AC08-explicit-12-cases {"covered":12,"combinations":[{"mode":"HTTP_500","control":"Dừng sau lớp này"},{"mode":"HTTP_500","control":"Dừng khẩn cấp"},{"mode":"HTTP_500","control":"Quét điểm BTVN & Đẩy sang Teaching"},{"mode":"HTTP_500","control":"Tạo 5 nhiệm vụ SPCK"},{"mode":"HTTP_200_EMPTY","control":"Dừng sau lớp này"},{"mode":"HTTP_200_EMPTY","control":"Dừng khẩn cấp"},{"mode":"HTTP_200_EMPTY","control":"Quét điểm BTVN & Đẩy sang Teaching"},{"mode":"HTTP_200_EMPTY","control":"Tạo 5 nhiệm vụ SPCK"},{"mode":"HTTP_200_INVALID_JSON","control":"Dừng sau lớp này"},{"mode":"HTTP_200_INVALID_JSON","control":"Dừng khẩn cấp"},{"mode":"HTTP_200_INVALID_JSON","control":"Quét điểm BTVN & Đẩy sang Teaching"},{"mode":"HTTP_200_INVALID_JSON","control":"Tạo 5 nhiệm vụ SPCK"}]}
PASS AC11-unrounded-boundary-source {"tinyExtras":2,"delta":0.0000012,"unrounded":true}
PASS BROWSER-single-product-context ["src\\lib\\playwright\\browser-manager.ts"]
PASS UI-HTTP_500-stop {"mode":"HTTP_500","control":"stop","errorBanner":true,"falseSuccess":0}
PASS UI-HTTP_500-emergency {"mode":"HTTP_500","control":"emergency","errorBanner":true,"falseSuccess":0}
PASS UI-HTTP_500-btvn {"mode":"HTTP_500","control":"btvn","errorBanner":true,"falseSuccess":0}
PASS UI-HTTP_500-spck {"mode":"HTTP_500","control":"spck","errorBanner":true,"falseSuccess":0}
PASS UI-HTTP_200_EMPTY-stop {"mode":"HTTP_200_EMPTY","control":"stop","errorBanner":true,"falseSuccess":0}
PASS UI-HTTP_200_EMPTY-emergency {"mode":"HTTP_200_EMPTY","control":"emergency","errorBanner":true,"falseSuccess":0}
PASS UI-HTTP_200_EMPTY-btvn {"mode":"HTTP_200_EMPTY","control":"btvn","errorBanner":true,"falseSuccess":0}
PASS UI-HTTP_200_EMPTY-spck {"mode":"HTTP_200_EMPTY","control":"spck","errorBanner":true,"falseSuccess":0}
PASS UI-HTTP_200_INVALID_JSON-stop {"mode":"HTTP_200_INVALID_JSON","control":"stop","errorBanner":true,"falseSuccess":0}
PASS UI-HTTP_200_INVALID_JSON-emergency {"mode":"HTTP_200_INVALID_JSON","control":"emergency","errorBanner":true,"falseSuccess":0}
PASS UI-HTTP_200_INVALID_JSON-btvn {"mode":"HTTP_200_INVALID_JSON","control":"btvn","errorBanner":true,"falseSuccess":0}
PASS UI-HTTP_200_INVALID_JSON-spck {"mode":"HTTP_200_INVALID_JSON","control":"spck","errorBanner":true,"falseSuccess":0}
PASS UI-no-page-errors {"pageErrors":[]}
PASS TEACHER-isolation {"teacherTables":11,"seededTables":["class_report_cards","classes_sessions"],"jsonUnchanged":true,"profileCalls":0}
INDEPENDENT_SUMMARY {"total":119,"passed":119,"failed":0}
```

Nguyên văn stderr:

```text
◇ injected env (0) from .env.local
◇ injected env (0) from .env
[AuthService.withAdminLmsSession] [Auth Restore Error] Khôi phục phiên LMS Giáo viên thất bại: Danh tính LMS sau khôi phục là "<chưa xác định>", không khớp phiên Giáo viên ("round5_teacher@mindx.edu.vn").
[AuthService.withAdminLmsSession] [Auth Restore Error] Khôi phục phiên LMS Giáo viên thất bại: cookie locked R5
```

### node C:\Users\QQ\AppData\Local\Temp\mindx-v350-round5-meta\guard-selftest.cjs

Receipt: `guard-final-receipt.json`. **Exit 0**.

Nguyên văn stdout:

```text
PASS GUARD fs-write-stage
PASS GUARD fs-mkdir-stage
PASS GUARD fs-env-read
PASS GUARD fs-data-read
PASS GUARD fs-profile-read
PASS GUARD tcp-options
PASS GUARD tcp-positional
PASS GUARD http-url
PASS GUARD https-options
PASS GUARD dns
PASS GUARD tls
PASS GUARD udp
PASS GUARD fetch
PASS GUARD fs-promises
GUARD_SELFTEST 14/14 PASS
```

Nguyên văn stderr:

```text
(không có đầu ra)
```

Các dòng `Auth Restore Error` là lỗi cố ý tiêm để chứng minh khôi phục thất bại phải từ chối thành công. Dòng dotenv “injected env (0)” chỉ là thông báo thư viện sau khi guard trả ENOENT; nội dung `.env`/`.env.local` không được mở. AC-03/04 in chung một dòng nên 10 dòng PASS đại diện 11 nhóm AC. Trong log JSON, NaN/Infinity được JSON.stringify biểu diễn thành null; tên ca W-NaN/W-Infinity ghi rõ giá trị JavaScript thật đã đưa vào.

### Minh bạch các lượt chuẩn bị

Giữ lại các receipt/log chuẩn bị, không dùng chúng làm bằng chứng chốt:

- `suite-receipt.json`: guard ban đầu từ chối nhầm tên pipe nội bộ tsx mặc dù pipe trỏ vào meta. Đã chuẩn hóa tiền tố pipe Windows, không nới quyền ghi ra ngoài meta.
- `suite-final-receipt.json`: quy tắc chặn DNS ban đầu cũng chặn IP loopback của máy chủ giả, nên Chromium không mở được trang. Đã thêm đúng địa chỉ loopback vào ngoại lệ; proxy chặn mạng ngoài vẫn giữ nguyên. Suite chốt `suite-confirmed` chạy đủ và exit 0.
- `independent-receipt.json` và `independent-preparation-results.json`: 5 FAIL/104 do harness gọi sai tên hàm SPCK batch (TypeError trước khi vào ứng dụng). Đã sửa tên hàm đúng, cải thiện các đối chứng Host và bổ sung các ca auth/ngày/bài chưa chấm/điều kiện buổi; lượt chốt `independent-final` đạt 119/119. Không thay đổi bất kỳ tệp sản phẩm nào.
- `tsc-receipt.json` và `guard-receipt.json` là lượt đạt trước đó; đã chạy lại `tsc-final` và `guard-final` với guard cuối.

Các lần Playwright muốn ghi marker vào cache trình duyệt ngoài meta đều bị guard chặn **trước khi ghi**; Chromium vẫn chạy với profile/temp bên trong meta. Chi tiết ở `guard-events.jsonl`. Không có lỗi sản phẩm còn treo bị che bởi việc đổi harness.

## Đóng các điểm còn lại của Round 4

### Round 1 #8 — Tổng SPCK chưa làm tròn

Đã kiểm trực tiếp `admin-lms-scanner.ts:273` là `const totalWeightPercent = rawWeightSum;` và :377 dùng `Math.abs(rawWeightSum - 100) > 1e-6`. Không còn Math.round, toFixed hay đổi số làm tròn trong đường tính tổng của evaluator. `admin-teaching-actions.ts:1070` gọi evaluator chung sau đọc lại; :1079 giữ nguyên `compliance.totalWeightPercent`, chỉ ghi VERIFIED khi taskStatus là READY. Phép Math.round còn ở :1067 chỉ tính tiến độ trung bình, không tham gia kiểm tổng tỷ trọng.

AC-11 chứa đúng `[20,20,20,20,20,6e-7,6e-7]`, kiểm evaluator, provisioning, DB INCOMPLETE và 0 xóa. Kết quả độc lập dưới đây dùng chính hàm provisioning và DB SQLite; trường `http` là `statusCode` mà route dùng để tạo HTTP response, không phải lời gọi Teaching thật.

Bằng chứng `weight-near-threshold.json`:

```json
{
  "weights": [
    20,
    20,
    20,
    20,
    20,
    6e-7,
    6e-7
  ],
  "rawTotal": 100.00000120000001,
  "reportedTotal": 100.00000120000001,
  "evaluator": "INCOMPLETE_TASKS",
  "http": 409,
  "provision": "NEEDS_ATTENTION",
  "dbStatus": "INCOMPLETE",
  "deletes": 0,
  "writes": 5,
  "extraUnchanged": true
}
```

Bằng chứng `weight-zero-control.json`:

```json
{
  "weights": [
    20,
    20,
    20,
    20,
    20,
    0
  ],
  "rawTotal": 100,
  "reportedTotal": 100,
  "evaluator": "READY",
  "http": 200,
  "provision": "VERIFIED",
  "dbStatus": "VERIFIED",
  "deletes": 0,
  "writes": 5,
  "extraUnchanged": true
}
```

Sai lệch thực của ca sát ngưỡng là **0.000001200000014023317 > 1e-6**, giá trị báo cáo bằng đúng tổng thực. Cả hai ca đều giữ nguyên nhiệm vụ phụ và **0 lần xóa**. Mỗi ca có 5 lời gọi saveTask giả để ghi/đọc lại năm nhiệm vụ chuẩn; yêu cầu 0 deletes đã đạt, không diễn giải thành 0 mọi lần ghi. Các trọng số 0.1, âm, NaN, Infinity và chuỗi không hợp lệ cũng bị chặn VERIFIED.

### R3-01 / Round 1 #15 — AC-08 đủ 12/12 và helper JSON không hồi quy

| Nút được bấm ngay trong AC-08 | HTTP_500 | HTTP_200_EMPTY | HTTP_200_INVALID_JSON |
|---|---|---|---|
| Dừng sau lớp này | PASS | PASS | PASS |
| Dừng khẩn cấp | PASS | PASS | PASS |
| Quét điểm BTVN & Đẩy sang Teaching | PASS | PASS | PASS |
| Tạo 5 nhiệm vụ SPCK | PASS | PASS | PASS |

Nhánh HTTP500 có click Stop-after-current tại dòng 1278 và kiểm không có câu gửi lệnh thành công; hai mode HTTP200 dùng vòng lặp tại :1326 với đủ bốn nút. `AC08-explicit-12-cases` ghi đủ 12 tổ hợp và suite hiện tại thực thi qua AC-08. Bộ Chromium độc lập bấm lại đủ 12 tổ hợp, kiểm có banner lỗi và không có câu hoàn tất/đã dừng giả; pageErrors rỗng.

`readJsonObjectResponse` tại Workspace:46–77 yêu cầu `res.ok && !invalidJson && parsedObj.success === true`; 12 ca parser thực thi từ nguồn hiện tại đạt, gồm HTTP500 success:true, HTTP200 rỗng/hỏng/mảng/null/giá trị đơn, success:false và chuỗi true, cùng đối chứng 200/201 success:true. Cả 8 điểm fetch (143, 214, 266, 303, 341, 388, 444, 491) dùng helper. Cửa sổ không polling khi rảnh và dừng polling khi scan kết thúc được AC-08 hiện tại kiểm thành công; không suy rộng thành kiểm dài ngày.

### R3-03 — Tài liệu nhất quán và chưa tự tuyên bố GO

Đã đọc toàn bộ vùng v3.5.0/Phase12 trong ba tệp, đặc biệt PROJECT_STATE Mục 2 và 5. Cả ba đều không còn chuỗi `:memory:`; mô tả nhất quán AC-01..AC-11, ADV-01..ADV-20, R2-01..R2-07 và DB tạm `mindx_admin_test.db` tạo qua `fs.mkdtempSync(path.join(os.tmpdir(), ...))`. Đây là cách suite thực sự chạy, được xác nhận ở dòng 11–21 của script và đường dẫn temp bị ràng buộc trong meta.

PROJECT_STATE:47, :100, :185 đã hết mô tả AC-10 cũ; CHANGELOG:55 và kế hoạch:775–778 đã đồng bộ. Các ca chức năng #8/R3-01/R3-02 được tách khỏi việc đọc/đối chiếu tài liệu R3-03; không nhận rằng suite chức năng tự kiểm tài liệu. Mục 2 vẫn “ĐANG NGHIỆM THU VÒNG CUỐI”; TASK-12.6 còn `[ ]` và “Chờ VERDICT: GO từ Codex CLI Round 5”. Những GO ở các phiên bản cũ trong lịch sử không phải tuyên bố GO sớm cho Phase12. Ba ca DOC đều PASS; các trích đoạn đã đọc lưu ở `doc-PROJECT_STATE.md`, `doc-CHANGELOG.md`, `doc-MINDX_AUTOMATION_PLAN.md`.

## Ma trận đóng đủ 25 phát hiện (Complete 25-Finding Closure Matrix)

CLOSED nghĩa là lỗi gốc và biến thể yêu cầu không tái hiện trong nguồn/ca kiểm ngoại tuyến hiện tại. Không có nghĩa đã chứng minh mọi biến thể có thể có hoặc đã nghiệm thu dịch vụ thật. Tên tệp rút gọn tính từ staging; các đoạn nguồn có số dòng và SHA-256 lưu trong `source-evidence.md`.

| ID | Mức gốc | Trạng thái | Vấn đề | Bằng chứng Round 5 |
|---|---|---|---|---|
| Round 1 #1 | P1 | **CLOSED** | Trả lại đúng phiên giáo viên | auth.ts:922–1021; `AC-02`, `ADV-01/02`; `AUTH-*` độc lập: Admin không nhận diện/sai danh tính có 0 lần chạy việc; callback lỗi vẫn gọi khôi phục; khôi phục rỗng/lỗi đều từ chối kết quả. |
| Round 1 #2 | P1 | **CLOSED** | Không lộ bí mật trong lỗi | secret-redactor.ts:75–120 và bốn route Admin; `AC-01`, `ADV-07/18`, `SECRET-public-redaction`: bốn bí mật giả và Bearer không xuất hiện trong lỗi đã che/cấu hình công khai; suite kiểm cả job_logs. |
| Round 1 #3 | P1 | **CLOSED** | Danh sách mã lớp sai không biến thành tất cả lớp | admin-teaching-actions.ts:146; `ADV-06`, 10 ca `SCOPE-BTVN/SPCK-*`: rỗng, sai, trộn đúng/sai, object, null đều trả statusCode 400, 0 lần gọi transport được giám sát. |
| Round 1 #4 | P1 | **CLOSED** | Không nhận dữ liệu của lớp khác | admin-lms-scanner.ts:194, :707 và :3476; `ADV-13`, `IDENTITY-wrong-id/code`: sai riêng ID hoặc riêng mã đều bị từ chối trước tính/lưu. |
| Round 1 #5 | P1 | **CLOSED** | Danh sách đọc thiếu không loại lớp cũ | scanner:2907–3037, :3643–3659; `ADV-12`, `DISCOVERY-partial-keeps-old`: discovery không đủ báo PARTIAL và giữ lớp R5KEEP. Kiểm nguồn chỉ prune sau ALL hoàn toàn sạch. |
| Round 1 #6 | P2 | **CLOSED** | Lỗi đọc không xóa số liệu tốt/báo xong | scanner:3474–3632; `ADV-04`, `R2-03`, `CACHE-subError/worksError/error`: một lớp lỗi + một lớp khỏe -> PARTIAL, success=false, giữ nguyên chuỗi JSON BTVN/SPCK tương ứng. |
| Round 1 #7 | P2 | **CLOSED** | Stop không giữ khóa quét vĩnh viễn | scanner:2653–2677, :3738–3765; `ADV-03`, `LOCK-db-busy-retry`, `RUNID-fixed-stop-resume`: cờ isRunning được mở; quét tiếp thành công trong cùng tiến trình. |
| Round 1 #8 | P2 | **CLOSED** | SPCK chỉ VERIFIED khi đủ điều kiện | scanner:273, :377; actions:1070–1138; bảy ca `W-*` thực thi evaluator + provisioning + SQLite. Tổng 100.00000120000001 -> INCOMPLETE_TASKS/409 NEEDS_ATTENTION/DB INCOMPLETE; 100% -> READY/200/VERIFIED; cả hai 0 deletes. `AC-11` có đúng hai nhiệm vụ 6e-7. |
| Round 1 #9 | P2 | **CLOSED** | Không tạo SPCK trước Buổi 10 | actions:644–703 và :1217; `ADV-20`, `ELIGIBILITY-session-0/1/9`: statusCode 400, 0 lần gọi transport trước kiểm điều kiện. |
| Round 1 #10 | P2 | **CLOSED** | Bài đã chấm không che bài chưa chấm | scanner:1102–1138; `ADV-09`, `BTVN-ungraded-independent-of-graded`: thêm bài SUBMITTED cùng học viên/cùng ô đã MARKED vẫn có ungraded=1. |
| Round 1 #11 | P2 | **CLOSED** | So điểm sau khi quy về cùng thang | scanner:524; `ADV-19` của suite vừa chạy: 80/100 LMS tương đương 4/5 Teaching, isOutOfSyncWithTeaching=false. Đã đọc fixture và nhánh quy đổi; không dùng kết quả lịch sử thay lượt hiện tại. |
| Round 1 #12 | P2 | **CLOSED** | Buổi 14 đòi đủ năng lực và thư ba phần | scanner:176, :1394–1460; `ADV-11`, `S14-missing-0/8-criteria`: có điểm Demo nhưng chỉ 0/9 hoặc 8/9 tiêu chí và thư hai phần -> cả 2 học viên bị báo thiếu. |
| Round 1 #13 | P2 | **CLOSED** | Không dùng kết quả buổi cũ | scanner:437, :486; `ADV-10`, `DATE-*`: ghép lớp/buổi/ngày; sai/trống ngày không được nhận hoàn thành. Không dùng dòng cuối khác buổi. |
| Round 1 #14 | P2 | **CLOSED** | Nợ học bù lọc đúng và đọc tiếp trang | admin-teaching-scraper.ts:365–468, :551–611; `ADV-08/14`, `R2-06` trong suite hiện tại: loại ca đã học/hủy, đọc tiếp >200 dòng, cảnh báo khi thiếu tổng; đã đọc cả nhánh HTML và JSON/phân trang. |
| Round 1 #15 | P2 | **CLOSED** | Giao diện không báo thành công khi lỗi | AdminCenterWorkspace.tsx:46–77 và 8 điểm fetch; `AC-08` hiện đủ 12/12, độc lập `JSON-*` và `UI-*` đủ 12 tổ hợp; HTTP500/200 rỗng/200 JSON hỏng đều có lỗi, 0 câu hoàn tất/dừng giả. |
| R2-01 | P1 | **CLOSED** | JSON hỏng không kích hoạt hàng loạt | local-guard.ts:80; scan/sync-btvn/provision-spck-tasks routes; `AC-10`, 27 ca `BODY-*` gọi handler thật: tất cả HTTP400, số scan run không tăng, profile thật 0. Route trả trước khi đi vào thao tác ghi. |
| R2-02 | P2 | **CLOSED** | createScanRun lỗi không làm kẹt quét | scanner:2653–2677, :3738–3765; `AC-10`, `LOCK-db-busy-retry`: tiêm SQLITE_BUSY, isRunning=false; phục hồi phương thức rồi retry COMPLETED, không khởi động lại. |
| R2-03 | P2 | **CLOSED** | Lỗi HTTP/GraphQL không ghi đè cache | scanner:2389–2530, :3170–3338, :3587–3629; `AC-10`, 9 ca `GQL-*`: submissions/works/class × HTTP503 errors, HTTP503 kèm data, HTTP200 errors kèm data đều reject. Ba ca CACHE xác minh PARTIAL và giữ JSON cũ. Response VM chỉ có ok/status/json. |
| R2-04 | P2 | **CLOSED** | Năm nhiệm vụ tùy ý không được coi đủ chuẩn | scanner:231–417; actions:847–898, :1070; `AC-10` R2-04 vừa chạy: tên/tỷ trọng sai bị INCOMPLETE_TASKS, AUTO chọn và tạo đủ chuẩn; nhiệm vụ phụ hợp lệ 0% được giữ. Ca tổng sát ngưỡng kiểm riêng tại #8. |
| R2-05 | P2 | **CLOSED** | Teaching 0 học viên vẫn phát hiện lệch | scanner:1627–1659; `AC-10`, `ROSTER-zero-students`: LMS 2, Teaching thành công [] -> mismatch=true; đối chứng endpoint students lỗi -> mismatch=false, tránh cảnh báo do lỗi đọc. |
| R2-06 | P2 | **CLOSED** | Trang học bù rỗng sớm phải cảnh báo | scraper:589–603; `AC-10` R2-06 vừa chạy: recordsFiltered=250, nhận 1 rồi rỗng -> cảnh báo 1/250 và lượt quét success=false; không báo hoàn tất sạch. |
| R2-07 | P2 | **CLOSED** | Không nhận trạng thái từ sai ngày/biên UTC+7 | scanner:437–521, sqlite.ts:5180; `AC-10`, 5 ca `DATE-*`: ngày sai/trống/hỏng đều Chưa xác minh; 2026-12-16T17:00Z khớp 17/12/2026 và nhận đúng hoàn thành. |
| R3-01 | P2 | **CLOSED** | HTTP200 thiếu xác nhận và đủ ca AC-08 | Workspace:46–77; suite:1275–1373. `AC08-explicit-12-cases` xác nhận 4 nút × 3 mode nằm ngay trong AC-08, gồm Stop-after-current HTTP500; suite chạy thành công. React Chromium độc lập 12/12 và parser 12/12 đạt; 8/8 fetch dùng helper. |
| R3-02 | P2 | **CLOSED** | Mã lượt quét khác nhau trong cùng mili giây | scanner:2649 UUID; `AC-11`, `RUNID-fixed-stop-resume`: Date.now cố định 1794680000000; STOPPED rồi COMPLETED, hai runId khác nhau, không UNIQUE constraint, isRunning=false. |
| R3-03 | P3 | **CLOSED** | Ba tài liệu mô tả đúng bằng chứng | PROJECT_STATE.md:47, :100 (Mục 2), :185 (Mục 5); CHANGELOG.md:55; MINDX_AUTOMATION_PLAN.md:775–778. Ba ca DOC đạt; không còn :memory: hay mô tả AC-10 cũ trong vùng Phase12; AC-11/ADV20/R2-07/DB tạm os.tmpdir nhất quán; tách kiểm chức năng với đối chiếu tài liệu và vẫn chờ Round5 GO. |

Tổng theo vòng: Round 1 **15/15 CLOSED**; Round 2 **7/7 CLOSED**; Round 3 **3/3 CLOSED**. R3-01 tiếp tục cùng hành vi của #15 nhưng được theo dõi riêng theo danh sách 25 ID. Không đếm trùng thành một lỗi mới. Không thấy hồi quy của các ca ADV/R2 trong lượt suite mới.

## Bảo mật, chất lượng mã, cách ly (Security, Code Quality & Isolation)

- **Thiết kế sửa lỗi:** evaluator SPCK dùng chung giữa quét/chọn AUTO/đọc lại sau ghi; helper JSON dùng chung cho 8 đường gọi. Cách sửa nhỏ, không cần thêm tầng kiến trúc. UUID bổ sung cho runId giải quyết va chạm cùng thời điểm đã thử.
- **Local-only:** package dev/start bind 127.0.0.1. Bốn đối chứng URL/Host/Origin/cross-site trả HTTP403 độc lập; ba route mutation từ chối 27 thân yêu cầu hỏng/thiếu mode với HTTP400. 10 danh sách lớp chỉ định sai trả 400 trước gọi transport. Đây là kiểm các guard hiện tại, không phải một cuộc kiểm thử xâm nhập mạng thật.
- **Bí mật và ranh giới giao diện:** config công khai che tên và không có bốn bí mật giả được thử; redactor che cả Bearer. AC-07 xác nhận ba tệp giao diện Admin không nhập mô-đun config/DB/auth chứa bí mật hoặc dùng process.env. Không đọc khóa thật, không kết luận đã rà mọi khóa trên máy.
- **Trình duyệt/hàng đợi:** nguồn sản phẩm chỉ có một nơi launchPersistentContext là browser-manager.ts và không có .newContext trong src. Scanner/BTVN/SPCK đi qua taskQueue.enqueue; finally ngoài enqueue dọn khóa. Context Chromium thử là context riêng trong meta. Không mở context/profile sản phẩm: bộ độc lập profileCalls=0; suite cũng thay getPage/getContext bằng hàm cấm.
- **Đọc lại sau ghi:** AC-05 đối chiếu điểm BTVN và chặn Robotics; AC-06/11 cùng bảy W probes kiểm SPCK đọc lại, đủ người nhận/chuẩn/tổng; Math.max giữ tiến độ không giảm. Các transport chỉ nhận dữ liệu giả.
- **Giữ dữ liệu tốt:** 9 phép GraphQL VM chặn HTTP/GraphQL lỗi, 3 cache probe giữ chuỗi JSON cũ và báo PARTIAL. Lớp sai ID/mã bị chặn; danh sách chưa đủ không prune.
- **Cách ly giáo viên:** đối chiếu toàn bộ nội dung **11 bảng** ngoài admin_center_*, job_logs và sqlite_sequence; gieo dữ liệu giả vào classes_sessions và class_report_cards. Trước/sau giống hệt; running_classes.json giả giữ nguyên. job_logs được phép thêm log thử nên không đưa vào danh sách bất biến bảng giáo viên.
- **Hàng rào chạy thử:** offline.cjs chặn TCP/HTTP/HTTPS/fetch/DNS/TLS/UDP ngoài loopback và từ chối ghi Node ngoài meta; tự kiểm 14 nhánh đạt. Chromium bị buộc dùng proxy loopback đóng, host resolver chặn ngoài, chỉ miễn địa chỉ loopback cho máy chủ giả; profile/user-data-dir và TEMP nằm trong meta. Probe giao diện còn chặn request có origin khác máy chủ giả. Không có yêu cầu LMS/Teaching/Gemini thật được cho phép.
- **Tệp bị cấm:** dotenv đọc .env/.env.local bị trả ENOENT trước mở; đọc nội dung data/playwright-auth/temp_submissions bị chặn. Chỉ giả lập existsSync=true cho đúng ba thư mục mặc định chưa dùng để constructor không thử tạo chúng; không mở nội dung hoặc chuyển hướng dữ liệu thật. Bốn đường MINDX vào meta vẫn được dùng cho dữ liệu thử. Các thư viện chia sẻ được dùng chỉ đọc qua node_modules như ngoại lệ được người yêu cầu cho phép. Không xem cache marker bị chặn là một lần ghi thành công.
- **Độ rộng kết luận:** đã chạy các kiểm tra được yêu cầu và các biến thể độc lập nêu rõ. Không tự chạy build/deployment hoặc toàn bộ suite lịch sử; không mở rộng thành chứng nhận an toàn tuyệt đối toàn bộ ứng dụng/thư viện.

## Bất biến SHA-256 trước và sau (Immutability Confirmation)

`baseline.json` được tạo trước khi nhập mã ứng dụng/chạy cổng. `after.json` được tạo sau toàn bộ cổng/probe. So từng đường dẫn, kích thước, thời điểm ghi và SHA-256; so cả danh sách thư mục và thông tin mục được loại trừ.

```json
{
  "beforeFiles": 192,
  "afterFiles": 192,
  "unchangedFiles": 192,
  "added": [],
  "removed": [],
  "changed": [],
  "directoriesUnchanged": true,
  "excludedMetadataUnchanged": true,
  "baselineSha256": "6884e5754a7bcebfa2eacb765303ffac10bcabf8e1509fede9441e6b9f453b50",
  "afterSha256": "6884e5754a7bcebfa2eacb765303ffac10bcabf8e1509fede9441e6b9f453b50",
  "pass": true
}
```

Hai manifest có SHA-256 **giống hệt nhau**: `6884e5754a7bcebfa2eacb765303ffac10bcabf8e1509fede9441e6b9f453b50`. Không có tệp/thư mục mới, mất hoặc đổi trong staging. Không sửa/xóa báo cáo lịch sử hoặc prompt. Nội dung junction node_modules và `.env*`, data/playwright-auth/temp_submissions không được duyệt/băm. Baseline chỉ có hai mục loại trừ hiện hữu: `.env.example` (chỉ metadata, không đọc nội dung) và junction node_modules (chỉ metadata/đích liên kết). Thông tin cả hai giữ nguyên. Không có data/playwright-auth/temp_submissions được tạo trong staging; không khẳng định đã băm dữ liệu thật hoặc toàn bộ thư viện ngoài staging.

| Tệp trọng tâm | SHA-256 trước | SHA-256 sau |
|---|---|---|
| `src/lib/admin-center/admin-lms-scanner.ts` | `69eb75dc533bd48ee80872982d50eeb1ef6c92c9aec767ae2fe802eed5336a6c` | `69eb75dc533bd48ee80872982d50eeb1ef6c92c9aec767ae2fe802eed5336a6c` |
| `src/lib/admin-center/admin-teaching-actions.ts` | `de2e0677b84ca64c014d0fd0dbd0d96631dde17700a4d4649fb4aec82733727b` | `de2e0677b84ca64c014d0fd0dbd0d96631dde17700a4d4649fb4aec82733727b` |
| `src/components/admin-center/AdminCenterWorkspace.tsx` | `2f8b5e98ff7889fec1c28a15270bb1b711e54f45365b2ca1ec9433c679b9f2fb` | `2f8b5e98ff7889fec1c28a15270bb1b711e54f45365b2ca1ec9433c679b9f2fb` |
| `scripts/test-admin-center-v350.ts` | `94216a2ec2fd3c0ad9069c57752d2e3c8e0529de22053c577bf0554fc6a277cf` | `94216a2ec2fd3c0ad9069c57752d2e3c8e0529de22053c577bf0554fc6a277cf` |
| `PROJECT_STATE.md` | `45b377f158a0efd25de2418409f7ecc1bfeefc927f2303ab5722967c38582316` | `45b377f158a0efd25de2418409f7ecc1bfeefc927f2303ab5722967c38582316` |
| `CHANGELOG.md` | `c989d72630e1b72017e24d92d0e5827a6cc6a43948866528c6e02877487e5eb8` | `c989d72630e1b72017e24d92d0e5827a6cc6a43948866528c6e02877487e5eb8` |
| `MINDX_AUTOMATION_PLAN.md` | `8c7edfad54814a5d1b670521e4f1e8ed7683f178ceb476daa4c75f42eef04836` | `8c7edfad54814a5d1b670521e4f1e8ed7683f178ceb476daa4c75f42eef04836` |

## Giới hạn xác minh thật (Explicit Scope & Live Verification Notes)

**`tuanpa` / `USER_DISABLED` so với `quangda`:** Ba tài liệu mô tả tài khoản LMS Admin tuanpa đang bị SSO báo USER_DISABLED và Teaching quangda đã sẵn sàng. Đây là **trạng thái được ghi trong tài liệu staging, chưa được kiểm tra lại trực tiếp ở Round 5**. Không xác nhận tài khoản tuanpa1 thay thế có quyền đúng; không đăng nhập hoặc thử mật khẩu. Teaching sẵn sàng không chứng minh quyền truy cập LMS đã hoạt động.

GO chỉ đóng các vấn đề mã/kiểm thử/tài liệu của vòng kiểm định này. Chưa kiểm chứng SSO thật, phát hiện toàn bộ lớp 205ALHP trên LMS thật, dữ liệu học viên thật, ghi điểm/nhiệm vụ thật, cookie thật, Gemini thật, giao diện đủ CSS trên mọi kích thước, production build/deployment hoặc trạng thái đồng bộ GitHub. Không đọc workspace sống ngoài staging; chỉ dùng thư viện chia sẻ được cho phép qua node_modules.

Bước tiếp theo sau khi Owner cho phép một đợt nghiệm thu thật riêng: xác nhận IT mở lại đúng tài khoản LMS Admin và quyền cơ sở; kiểm quét chỉ đọc trước rồi mới xét hành động ghi. Không có thao tác dịch vụ thật nào được thực hiện trong Round 5.

## Bàn giao

**Đã làm:** Kiểm định chỉ đọc đủ 25 ID, hai cổng bắt buộc, 119 ca độc lập, 14 kiểm hàng rào và SHA-256 trước/sau.

**Kết quả:** **VERDICT: GO** trong phạm vi ngoại tuyến; 25/25 CLOSED; staging 192/192 tệp bất biến. Toàn bộ nguồn kiểm định/log/DB/ảnh ở thư mục Round5 meta.

**Chưa kiểm tra:** Tài khoản và dịch vụ thật, dữ liệu thật, build/deployment và GitHub.

**Việc tiếp theo:** Có thể bàn giao kết quả đóng vòng cho agent triển khai; nghiệm thu thật cần được thực hiện riêng sau khi xử lý quyền tài khoản LMS. Owner không cần chạy terminal cho phần kiểm định ngoại tuyến này.

