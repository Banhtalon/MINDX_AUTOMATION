# v2.9.0 — Kiểm định Code & Quality độc lập, Round 9 — Buổi 14

Ngày kiểm định: **27/10/2026, UTC+7**. Reviewer: **Codex, trực tiếp thực hiện vai trò Independent Code & Quality Reviewer theo yêu cầu Owner**.

**Overall Verdict: GO.** Chạy mới **8/8 gates PASS, exit code 0** và **263/263 ca probe đúng kỳ vọng**: 119 ca Round 3/4/5 + 92 ca Round 6 + 42 ca Round 7 + 10 ca Round 8. **F01–F12 đều CLOSED** trong phạm vi kiểm định mã và dữ liệu mô phỏng. Bốn ca ghép nhầm phản hồi của Round 8 đã được sửa đúng; không còn VERIFIED sai hoặc từ chối nhầm trong các ca được yêu cầu.

**GO này là kết quả kiểm định mã và kiểm thử cục bộ; chưa phải nghiệm thu luồng v2.9.0 trên LMS/Gemini thật.** Trong repo chỉ thêm báo cáo Round 9, giữ nguyên mã nguồn, bài thử và bằng chứng các vòng trước.

## 1. Phạm vi, bản mã và cách chạy

- Đọc PROJECT_STATE.md đầu tiên; đọc các báo cáo CODEX_REVIEW_ROUND1.md đến CODEX_REVIEW_ROUND8.md, đối chiếu AGENTS.md, MINDX_AUTOMATION_PLAN.md, CHANGELOG.md, uploader, API gọi uploader và bài kiểm tra đã bổ sung.
- HEAD: **eeb73d31d51e5915b52ebbcea377aeee5c7384c1**. Kết luận áp dụng cho bản chụp thư mục làm việc, gồm mã mới chưa được Git theo dõi. Khi bắt đầu có 22 tệp được theo dõi đã sửa cùng các đường dẫn mới v280/v290; giữ nguyên các thay đổi có sẵn.
- So với manifest Round 8, đúng **2/128 đầu vào thay đổi**: src/lib/playwright/session14-eval-uploader.ts và scripts/test-session14-v290.ts. Các đầu vào khác, gồm những phần xử lý F02–F12, giữ nguyên dấu nội dung. Vẫn chạy lại đủ probe để xác minh hành vi hiện tại.
- Tạo **ba bản sao TEMP riêng**, mỗi bản có cùng **128 tệp đầu vào**, không thiếu tệp .ts/.tsx/.json trong src/ hoặc scripts/. Tám gates chạy tuần tự trong gates/workspace/; 92 ca nguồn máy chủ chạy trong server/workspace/; các probe còn lại chạy tuần tự trong probes/workspace/. Ba nhóm dùng DB và dữ liệu thử riêng, nên có thể chạy đồng thời mà không ghi đè lẫn nhau.
- Mỗi lệnh được cấp **timeout_ms=600000**. Giữ nguyên cửa sổ quan sát yêu cầu và chờ phản hồi **6000 ms** của ứng dụng; không rút ngắn thời gian chờ để làm kiểm tra chạy nhanh.
- Các script probe cũ được sao chép **nguyên byte** từ thư mục Round 8, gồm hai bản thích nghi uploader đã dùng từ Round 6. Không thay dữ liệu, kỳ vọng hoặc mã uploader để làm ca đạt.
- Không sao chép .env/.env.local, SQLite thật, playwright-auth hoặc teacher_browsed_dirs.json. Dùng tên học viên giả và GEMINI_API_KEY=ROUND9_SYNTHETIC_KEY trong tiến trình thử; loại biến mật khẩu và khóa bí mật kế thừa. AI và HTTP nghiệp vụ được mô phỏng.
- Dùng thư viện đã cài qua liên kết node_modules, không cài hoặc cập nhật thư viện. Môi trường kiểm tra: Windows, Node **v24.21.0**, npm **11.19.0**.
- Quy mô đánh giá: ứng dụng cục bộ cho một giáo viên, có mạng chậm, hai yêu cầu tải lại gần nhau, phản hồi đảo thứ tự, sửa chữ khi lưu và chuyển lớp.
- Theo giới hạn trực tiếp của Owner, giữ nguyên ba tài liệu trạng thái, tám báo cáo cũ và năm thư mục TEMP Round 4–8. Không commit, reset hoặc đổi HEAD.

Thư mục bằng chứng Round 9:

    C:/Users/QQ/AppData/Local/Temp/mindx-v290-round9-faadfd/

Giữ probes/, log, JSON, trình chạy và manifest tại đây. Các workspace cùng DB/dữ liệu thử đã được dọn sau khi hoàn tất kiểm tra; xem mục 6.

## 2. Đủ tám cổng kiểm tra bắt buộc

Thời gian chạy gates: **16:21:15–16:26:03, ngày 27/10/2026, UTC+7**. Mỗi lệnh chạy một lần, PASS ngay lượt đầu, không sửa bài thử.

| STT | Lệnh nguyên trạng | Kết quả | Exit code | Thời gian | Bằng chứng |
| --- | --- | --- | --- | --- | --- |
| 1 | npx tsc --noEmit | **PASS** | **0** | 1,379 giây | gates/gate-1.log |
| 2 | npx tsx scripts/test-session14-v290.ts | **PASS** | **0** | 153,549 giây | gates/gate-2.log |
| 3 | npx tsx scripts/test-lms-reliability-v280.ts | **PASS** | **0** | 84,212 giây | gates/gate-3.log |
| 4 | npx tsx scripts/test-spck-v270.ts | **PASS** | **0** | 3,753 giây | gates/gate-4.log |
| 5 | npx tsx scripts/test-spck-v272.ts | **PASS** | **0** | 32,737 giây | gates/gate-5.log |
| 6 | npx tsx scripts/test-phase5.ts | **PASS** | **0** | 1,776 giây | gates/gate-6.log |
| 7 | npx tsx scripts/test-phase6.ts | **PASS** | **0** | 9,435 giây | gates/gate-7.log |
| 8 | npx tsx scripts/test-phase7.ts | **PASS** | **0** | 1,219 giây | gates/gate-8.log |

gates/exits.json lưu thời điểm, thời gian, timeout, exit code và tên log của từng lệnh. Gate 2 đạt đủ **S14-01–S14-07**; gate 3 đủ **T280-01–T280-05**; gate 4 đủ **T01–T16**; gate 5 đủ **V01–V16**. Các lỗi HTTP/điểm cố ý tạo trong probe âm tính là đầu vào kiểm thử; kết quả PASS được xác định bằng hành vi từ chối đúng kỳ vọng.

## 3. Đối chiếu bản sửa theo mục 4.4 Round 8

### 3.1. Khóa phản hồi vào chính yêu cầu đã bắt — ĐẠT

Tại **src/lib/playwright/session14-eval-uploader.ts:865–888**, đặc biệt **dòng 875**, mã hiện tại là:

    .waitForResponse((res) => res.request() === req, {
      timeout: REOPEN_WINDOW_MS,
    })

Nhánh OR (|| isMatchingReopenRequest(res.request())) đã được bỏ hoàn toàn khỏi điều kiện nhận phản hồi. Bộ lọc nghiệp vụ vẫn dùng để chọn yêu cầu đầu tiên đúng lớp/buổi/học viên; sau đó chỉ phản hồi thuộc chính đối tượng yêu cầu ấy mới hoàn tất bộ chờ. Phản hồi của yêu cầu thứ hai cùng định danh không thay được phản hồi thứ nhất.

Các bảo vệ trước đó vẫn còn:

- Dòng 865, 875–885: cả quan sát yêu cầu và chờ phản hồi dùng 6000 ms; thời hạn phản hồi bắt đầu khi bắt được yêu cầu.
- Dòng 893–945: đã bắt yêu cầu mà hết hạn, HTTP khác 200/201, JSON hỏng, GraphQL lỗi hoặc thiếu đối tượng đánh giá đều dừng.
- Dòng 1014–1044: khi có yêu cầu tải lại, xác minh dữ liệu tải lại; không dùng phản hồi Save đầy đủ để bỏ qua lỗi của lần tải lại. Khi không có yêu cầu tải lại trong cửa sổ, nguồn Save đầy đủ vẫn được kiểm.
- Hàm verifyServerEvaluationPayload tại dòng 59–250 kiểm đủ ba phần thư, chín năng lực, năm điểm Demo và định danh có trong dữ liệu trả về; năng lực máy chủ phải là số nguyên 1..5 và bằng bản duyệt.
- Chốt nội dung/buổi ngay trước Save, đối chiếu toàn văn DOM và điểm/radio, rồi mới markVerified vẫn được giữ.

### 3.2. Đủ bảy ca bổ sung trong bài thử repo — ĐẠT

Tại **scripts/test-session14-v290.ts:1231–1420**, có đủ:

- fullsave-reopen-6500ms-fractional
- first-500-second-valid
- first-fractional-second-valid
- first-timeout-second-valid
- first-valid-second-500
- first-500-second-wrong-class
- first-valid-second-valid

Fixture phát FIRST khi mở lại và SECOND sau 100 ms, giữ độ trễ FIRST 700/6500 ms và hai control đúng yêu cầu. Kiểm tra cả verifiedCount và failedCount; tất cả chạy qua gate 2 trên nguyên bản nguồn.

Phần cuối bài thử mang tên “F07, F08 & F12” vẫn chỉ thực thi hàm chọn buổi; bằng chứng đóng F07/F08 trong Round 9 còn có probe độc lập chạy handler thật trong React/ReactDOM/Chromium, không dựa riêng tên nhóm kiểm tra.

### 3.3. Chạy lại nguyên 10 ca round8-extra.ts — 10/10 ĐẠT

Save trả dữ liệu đầy đủ đúng. FIRST là yêu cầu tải lại được bắt đầu tiên; SECOND phát sau 100 ms và trả trước FIRST. Mọi ca dưới có **opens=2, requests=3, saved=true**, gồm một Save và hai lần đọc.

| Ca | Kỳ vọng verified | Thực chạy verified / failed | SQLite |
| --- | --- | --- | --- |
| FIRST-500-SECOND-VALID | 0 | **0 / 1** | FAILED |
| FIRST-FRACTIONAL-SECOND-VALID | 0 | **0 / 1** | FAILED |
| FIRST-TIMEOUT-SECOND-VALID | 0 | **0 / 1** | FAILED |
| FIRST-VALID-SECOND-500 | 1 | **1 / 0** | VERIFIED |
| FIRST-500-SECOND-WRONG-CLASS | 0 | **0 / 1** | FAILED |
| FIRST-VALID-SECOND-VALID | 1 | **1 / 0** | VERIFIED |

Ba VERIFIED sai cũ nay đều bị từ chối: FIRST lỗi HTTP 500, trả rating 4,4 hoặc vượt hạn 6000 ms vẫn nhận FAILED dù SECOND hợp lệ. Chiều ngược lại, FIRST hợp lệ/SECOND HTTP 500 nay VERIFIED theo FIRST. Hai control cũng đúng.

Ca fractional tiếp tục giữ **persisted.ratings[8]=4.4**, **serverResponse.ratings[8]=4.4**, **cached.ratings[8]=4**; payload SECOND là 4. Không đổi dữ liệu sai thành hợp lệ để tạo PASS. Log mạng xác nhận SECOND trả trước FIRST; ca timeout kết thúc FAILED trước khi phản hồi FIRST đến muộn.

Bốn ca còn lại cũng đúng: FULLSAVE-REOPEN-MALFORMED, FULLSAVE-REOPEN-GRAPHQL-ERROR và FULLSAVE-REOPEN-ID-ONLY đều failed=1 tại tải lại; REQUEST-4500-RESPONSE-5500-VALID verified=1, chứng minh thời hạn phản hồi được tính từ lúc bắt yêu cầu.

Bằng chứng: probes/round8-extra-results.json, probes/round8-extra.log và probes/exits.json.

## 4. Trạng thái F01–F12

CLOSED nghĩa là đã kiểm chứng ranh giới lỗi tương ứng trên dữ liệu giả của đúng bản mã này. Giữ giới hạn nghiệm thu dịch vụ thật riêng tại mục 7.

| ID | Trạng thái | Bằng chứng chạy mới |
| --- | --- | --- |
| **F01** | **CLOSED** | Dòng 875 đã khóa đúng request/response; 92/92 ca nguồn máy chủ, 42/42 ca Round 7 và 10/10 ca Round 8 đúng kỳ vọng. Bốn ca sai cuối Round 8 đã hết; control HTTP 200/201, thiếu nguồn, cache/closure, định danh, số lẻ, timeout và không bỏ qua tải lại đều đúng. |
| **F02** | **CLOSED** | Đủ sáu UPLOAD-TAIL-0/1/2 và UPLOAD-TRUNCATE-0/1/2 đều verified=0, failed=1, opens=2, lỗi tại đối chiếu toàn văn DOM. SERVER-OLD, RADIO-DRIFT, DEMO-DRIFT bị chặn; WHITESPACE đạt. |
| **F03** | **CLOSED** | UPLOAD-SLOT-DRIFT đổi buổi sang 13 trong lúc chọn radio: savedSlots=[], reqSeen=0, verified=0, failed=1; dừng trước Save. Helper điều hướng được mô phỏng để cô lập chốt này. |
| **F04** | **CLOSED** | AMBIGUOUS, CONFLICT, DUPLICATE đều matched=0 và giữ nguyên toàn bộ bản ghi cũ; control tên duy nhất, đủ điểm nhập được. |
| **F05** | **CLOSED** | F05-EDIT/APPROVE/VERIFY giữ AI chờ rồi thay bản hiện tại; cả ba CONFLICT, toàn bộ bản ghi mới không đổi. |
| **F06** | **CLOSED** | Bảy định dạng nhãn đồng bộ Demo 3,5 và năng lực 3,78; thiếu/không đọc được/sửa điểm thành 99 bị chặn. Đủ chín ca bổ sung Round 4 đúng kỳ vọng. |
| **F07** | **CLOSED** | Thiếu/sai version hoặc thiếu mục batch đều HTTP 400 và không đổi bản ghi; version cũ HTTP 409, không duyệt một phần; batch đủ version HTTP 200. React xác nhận dừng khi lưu chờ/lỗi; luồng đúng lưu chữ hiển thị → duyệt version 2 → upload. |
| **F08** | **CLOSED** | Năm nhánh load/save/import/AI/upload giữ đủ bảy trường đang sửa và lớp B; phản hồi v2 sau v3 không kéo lùi bản mới. Gõ khi approve/flush giữ chữ mới, WAITING_APPROVAL và contentHash rỗng. Upload cũ giữ nguyên bản v3. |
| **F09** | **CLOSED** | Đúng payload gửi model giả: Ý/ý/Y/y thành bốn STUDENT_SHORT_01; tên bạn trùng An thay trọn cụm; không dấu/NFD không còn phần tên từng sót. |
| **F10** | **CLOSED** | Bảng trống/thiếu B/chỉ 5 trong 20 ô E/âm/vượt trần/NaN đều matched=0 và giữ bản cũ. Năm điểm 0 thật nhập tổng 0; đủ B nhập 5, đủ E nhập 2 theo fixture. |
| **F11** | **CLOSED** | Không lịch sử/chỉ ABSENT/PRESENT đều INSUFFICIENT_INFO, không gọi AI; ghi chú thực nhận SUCCESS; thiếu knowledgeParagraph2 nhận ERROR. Prompt không có câu tham gia đầy đủ do hệ thống tự thêm. |
| **F12** | **CLOSED** | Chỉ 14/15 trả ID rỗng, sessions/students rỗng và dừng trước nạp học viên; 13/14 chỉ giữ/chọn 13. Kiểm nguyên hàm chọn buổi và khối lọc/nạp thật. |

## 5. Đủ 263 ca probe và cách đánh giá

Thời gian chạy probe: **16:21:15–16:30:51, ngày 27/10/2026, UTC+7**. Đủ **11 script hoàn tất ngay lượt đầu, exit code 0**, không lọc bỏ ca.

| Script trong probes/ | Số ca | Đúng kỳ vọng | Exit | Thời gian | JSON kết quả |
| --- | --- | --- | --- | --- | --- |
| round3-core.ts | 46 | **46/46** | **0** | 1,835 giây | probes/core-results.json |
| round6-from-round3-upload.ts | 33 | **33/33** | **0** | 182,513 giây | probes/upload-results.json |
| round3-ui.ts | 17 | **17/17** | **0** | 6,426 giây | probes/ui-results.json |
| round3-selector.ts | 3 | **3/3** | **0** | 1,147 giây | probes/selector-results.json |
| round4-upload-extra.ts | 3 | **3/3** | **0** | 25,898 giây | probes/upload-extra-results.json |
| round4-ui-extra.ts | 2 | **2/2** | **0** | 2,937 giây | probes/ui-extra-results.json |
| round4-score-extra.ts | 9 | **9/9** | **0** | 1,161 giây | probes/score-extra-results.json |
| round6-from-round5-upload-closure.ts | 6 | **6/6** | **0** | 50,664 giây | probes/upload-closure-results.json |
| round6-server-source.ts | 92 | **92/92** | **0** | 456,864 giây | server/server-source-results.json |
| round7-extra.ts | 42 | **42/42** | **0** | 239,244 giây | probes/round7-extra-results.json |
| round8-extra.ts | 10 | **10/10** | **0** | 64,160 giây | probes/round8-extra-results.json |
| **Tổng** | **263** | **263/263** | | | |

119 ca cũ dùng các probe Round 3/4/5 đã được thích nghi từ Round 6 như hồ sơ trước; 92 + 42 + 10 ca chạy nguyên script Round 6/7/8. Không cộng các ca trong tám gates vào 263 và không lấy kết quả chạy cũ thay kết quả mới.

**Exit 0 của probe chỉ chứng minh chương trình quan sát hoàn tất.** verify-evidence.mjs đối chiếu riêng số ca, kỳ vọng verified/failed, trạng thái SQLite, dữ liệu lưu/cache, lỗi tại DOM, thứ tự phản hồi và các điều kiện nhập điểm/duyệt/React/ẩn danh. Chương trình tổng hợp hoàn tất exit 0; evidence-summary.json ghi **GO, 263 đúng kỳ vọng, unexpected=[], falseVerified=[], falseRejected=[], 12 CLOSED, 0 OPEN**. Đây là kiểm tra bằng chứng, không phải gate thứ chín.

## 6. Dấu nội dung, bảo toàn bằng chứng và dọn dữ liệu thử

SHA-256 — dấu kiểm tra nội dung — của các tệp trọng tâm thực kiểm:

| Tệp | SHA-256 |
| --- | --- |
| src/app/final-project/page.tsx | 0f3b9ad7a6e7391b8007f87e1e5c76eca1f108f2dab61ee902d6aad64dd3d84e |
| src/app/session-comments/page.tsx | ac7e9d1f780cb5568ea0c721968cb2122157599590e1684f65ce2ead45472817 |
| src/app/api/spck/session14-eval/route.ts | 3d057b0bd3078bddcc6861ccb095ff71ccfc2c44ed39ebc99b607afbb3a82cc7 |
| src/lib/db/sqlite.ts | 422d639af47b7dbacb84738cf4cfab117d1bed2913d8fe363a11773db00e02af |
| src/lib/gemini/session14-course-summary.ts | e90a0ee42368508257fd89950cb73921e07f91d1e2bd1a4124c9be7a68c0dc80 |
| src/lib/local-files/spck-demo-score-reader.ts | 0f4e0e3bc44b565114104dc7620f61abacb1fc205ac8a5ad069783c1b59fd56a |
| src/lib/playwright/session14-eval-uploader.ts | 91f52cd7d8a405311248613c15b0581e6361be140994d64091b454bd1f5a2b6f |
| scripts/test-session14-v290.ts | d9acfae0d8bd1080e72f30736699709778205f2e0ef6d6bca311b65b53984c85 |
| next-env.d.ts | b8b3a344484b959af5e4e3fc1a1609dac3cb9ece0cdeb6c145be29bc4c491000 |

manifest.json ghi 128 đầu vào, 21 đường dẫn được bảo vệ và 310 tệp bằng chứng cũ. round8-source-delta.json ghi đúng hai thay đổi đầu vào so với Round 8.

Đối chiếu trước/sau kiểm tra và sau khi ghi báo cáo xác nhận:

- **128/128 đầu vào gốc không đổi**; cả ba bản sao có **128/128 đầu vào không đổi** trước dọn.
- **21/21 đường dẫn được bảo vệ** giữ nguyên trạng thái tồn tại/hash, gồm DB thật, cấu hình riêng, tài liệu trạng thái, next-env.d.ts, tsconfig.tsbuildinfo và tám báo cáo trước.
- **310/310 tệp bằng chứng** trong mindx-v290-round4-lu6e9k, mindx-v290-round5-6z0KJG, mindx-v290-round6-3Vlx5e, mindx-v290-round7-5db1c4 và mindx-v290-round8-7e352f không bị đổi/xóa; không thêm tệp vào năm thư mục này.
- Bản lưu **16 script probe nguyên trạng** tại Round 9 giữ cùng hash với nguồn Round 8. Các bản thực thi trong scratch/ cũng được kiểm tra trước khi dọn.
- git-before.txt, git-after.txt, integrity-before-cleanup.json, integrity-final.json và report-validation.json ghi bằng chứng repo chỉ thêm CODEX_REVIEW_ROUND9.md trong vòng này.

**Dọn bản sao:** xác minh đường dẫn tuyệt đối của từng workspace nằm trong đúng thư mục Round 9, lập danh sách tệp/thư mục, không đi theo liên kết thư viện; gỡ riêng liên kết node_modules rồi xóa từng tệp/thư mục rỗng. cleanup-result.json xác nhận **workspacesRemoved=true**, dọn **437 tệp / 227 thư mục**, giữ đủ 16 script cùng log/JSON, thư viện gốc vẫn còn. Không giữ DB thử.

## 7. Giới hạn và bàn giao

- Không đăng nhập, đọc danh sách học viên thật hoặc ghi LMS thật; không gọi Gemini/Google Sheets riêng tư/Drive/GitHub thật. Không lấy nghiệm thu lịch sử v270/v272/v280 làm nghiệm thu mới v290.
- Uploader được chạy thật trên DOM/HTTP mô phỏng; helper điều hướng được thay có chủ đích. Probe UI chạy handler trích nguyên trạng trong React/ReactDOM/Chromium; chưa phải kiểm toàn bộ trang Next.js hoặc modal LMS thật.
- Chưa chạy build phát hành; chưa xác nhận hợp đồng mutation/query, thứ tự trường và cơ chế tải lại trên LMS thật. Không khẳng định LMS thật phát hai query theo lịch fixture hoặc từng xảy ra sai dữ liệu thật.
- Phạm vi Round 9 là kiểm lại bản sửa và 263 ca được chỉ định, không phải kiểm toán mới toàn bộ hệ thống. Bằng chứng TEMP có thể bị hệ điều hành dọn; kết quả quyết định, dấu bản mã và các ca trọng tâm đã ghi trực tiếp trong báo cáo này.

**Đã làm:** đối chiếu tám báo cáo trước và bản sửa dòng 875; chạy đủ tám gates và 263 ca probe; chỉ tạo báo cáo Round 9, đã dọn dữ liệu thử.

**Kết quả:** **GO — F01–F12 CLOSED; 8/8 gates PASS; 263/263 ca probe đúng kỳ vọng.**

**Chưa kiểm tra:** LMS/Gemini và dữ liệu thật, build phát hành, toàn bộ giao diện thật.

**Việc tiếp theo:** có thể chuyển sang nghiệm thu có kiểm soát trên LMS thật với bản nội dung cụ thể đã được giáo viên duyệt. Owner không cần thao tác Terminal để hoàn tất Round 9.

