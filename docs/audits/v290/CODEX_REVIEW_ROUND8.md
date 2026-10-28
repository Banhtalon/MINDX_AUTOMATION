# v2.9.0 — Kiểm định Code & Quality độc lập, Round 8 — Buổi 14

Ngày kiểm định: **27/10/2026, UTC+7**. Reviewer: **Codex, trực tiếp thực hiện vai trò Independent Code & Quality Reviewer theo yêu cầu Owner**.

**Overall Verdict: NO-GO.** Đã chạy mới **8/8 gates PASS, exit code 0** và **253/253 ca được yêu cầu đúng kỳ vọng** (119 ca Round 3/4/5 + 92 ca nguồn máy chủ Round 6 + 42 ca Round 7). **Bốn ca còn lỗi của Round 7 nay đều đạt.** Tuy nhiên, kiểm tra điều kiện “chờ phản hồi của đúng yêu cầu đã bắt” tiếp tục tái hiện **3 VERIFIED sai và 1 từ chối nhầm** khi có hai yêu cầu tải lại cùng định danh. Vì vậy **F02–F12 CLOSED; F01 OPEN — HIGH**.

Có **263 ca riêng biệt**, gồm thêm 10 ca Round 8: **259 đúng kỳ vọng, 4 sai**. Sáu lượt xác nhận lại bốn ca sai cùng hai control giữ nguyên kết quả; không cộng vào số ca riêng biệt. Không sửa mã nguồn hoặc bài thử trong repo; chỉ thêm báo cáo này.

## 1. Phạm vi và bảo vệ đầu vào

- Đọc PROJECT_STATE.md đầu tiên, đọc đủ CODEX_REVIEW_ROUND1.md đến CODEX_REVIEW_ROUND7.md; đối chiếu AGENTS.md, MINDX_AUTOMATION_PLAN.md, CHANGELOG.md, uploader, nơi gọi và các bộ kiểm tra liên quan.
- HEAD: **eeb73d31d51e5915b52ebbcea377aeee5c7384c1**. Kết luận áp dụng cho bản mã thư mục làm việc đã chụp, gồm tệp mới chưa được Git theo dõi; không chỉ nội dung commit.
- Khi bắt đầu có 22 tệp được theo dõi đã sửa cùng các đường dẫn mới v280/v290. Không commit, reset hoặc thay HEAD; giữ nguyên công việc có sẵn.
- So với manifest Round 7, chỉ **hai trong 128 đầu vào thay đổi**: src/lib/playwright/session14-eval-uploader.ts và scripts/test-session14-v290.ts. Mã các phần F02–F12 còn lại giữ cùng hash; vẫn chạy lại các probe để kiểm tra hành vi trên bản hiện tại.
- Chạy tuần tự tám lệnh và các probe trong bản sao TEMP mới. Bản sao có **128 tệp đầu vào**, không thiếu tệp .ts/.tsx/.json trong src/ và scripts/. Không chỉnh thời hạn chờ của ứng dụng để rút ngắn kiểm tra.
- Không sao chép .env/.env.local, SQLite thật, playwright-auth hoặc teacher_browsed_dirs.json. Chỉ dùng tên/học viên giả; GEMINI_API_KEY=ROUND8_SYNTHETIC_KEY trong tiến trình thử, bỏ LMS_PASSWORD và TEACHING_PASSWORD. AI và HTTP nghiệp vụ được mô phỏng.
- Dùng thư viện hiện có qua liên kết node_modules; không cài/cập nhật thư viện. Môi trường đã kiểm tra: Windows, Node **v24.21.0**, npm **11.19.0**.
- Quy mô đánh giá: ứng dụng cục bộ cho một giáo viên, có mạng chậm, yêu cầu trùng gần nhau, phản hồi đảo thứ tự, gõ tiếp khi lưu và chuyển lớp.
- Theo phạm vi trực tiếp của Owner, không cập nhật ba tài liệu trạng thái hoặc báo cáo Round 1–7. Đối chiếu trước/sau: **128/128 đầu vào gốc và bản sao không đổi**, **20 đường dẫn được bảo vệ** giữ nguyên trạng thái tồn tại/hash, và **226 tệp bằng chứng** trong bốn thư mục Round 4/5/6/7 không thay đổi.

Thư mục bằng chứng mới:

    C:/Users/QQ/AppData/Local/Temp/mindx-v290-round8-7e352f/

Các lệnh chạy trong workspace/ của thư mục này. **Đã xóa workspace và toàn bộ DB/dữ liệu thử trước khi kết thúc**; giữ probe, log, JSON và manifest bên ngoài workspace.

## 2. Đủ tám cổng kiểm tra bắt buộc

Đợt chạy **15:49:14–15:53:28, ngày 27/10/2026, UTC+7**. Cả tám lệnh PASS ngay lượt đầu, không sửa bài thử để làm đạt.

| STT | Lệnh nguyên trạng | Kết quả | Exit code | Thời gian | Bằng chứng |
| --- | --- | --- | --- | --- | --- |
| 1 | npx tsc --noEmit | **PASS** | 0 | 3,124 giây | gate-1.log |
| 2 | npx tsx scripts/test-session14-v290.ts | **PASS** | 0 | 121,886 giây | gate-2.log |
| 3 | npx tsx scripts/test-lms-reliability-v280.ts | **PASS** | 0 | 82,052 giây | gate-3.log |
| 4 | npx tsx scripts/test-spck-v270.ts | **PASS** | 0 | 6,374 giây | gate-4.log |
| 5 | npx tsx scripts/test-spck-v272.ts | **PASS** | 0 | 26,559 giây | gate-5.log |
| 6 | npx tsx scripts/test-phase5.ts | **PASS** | 0 | 3,022 giây | gate-6.log |
| 7 | npx tsx scripts/test-phase6.ts | **PASS** | 0 | 9,575 giây | gate-7.log |
| 8 | npx tsx scripts/test-phase7.ts | **PASS** | 0 | 1,945 giây | gate-8.log |

gates.json lưu thời điểm, thời gian, exit code và tên log của từng lệnh. Thời gian chờ dài được giữ nguyên; các tiến trình được theo dõi đến khi hoàn tất.

**Đánh giá bài thử đã sửa:** scripts/test-session14-v290.ts:1231–1243 thêm ba ca tương ứng yêu cầu phát sau 450 ms/rating lẻ, yêu cầu phát sau 450 ms/HTTP 500 và bare ID/yêu cầu phát sau 1700 ms. Chưa có ca full Save/phản hồi 6500 ms trong danh sách bổ sung này; probe Round 7 độc lập vẫn kiểm tra đầy đủ ca đó. Các fixture chỉ phát một yêu cầu tải lại cho mỗi lượt mở, nên chưa bắt được việc ghép phản hồi sang yêu cầu thứ hai. Phần cuối mang tên F07, F08 & F12 vẫn không thay cho kiểm tra handler React; các probe UI độc lập đã chạy handler thật.

## 3. Trạng thái F01–F12

CLOSED nghĩa là đã kiểm chứng ranh giới lỗi trên dữ liệu giả của bản mã này, chưa phải nghiệm thu LMS/Gemini thật. Giữ nguyên mã finding; biến thể ghép phản hồi vẫn thuộc F01.

| ID | Trạng thái | Bằng chứng mới |
| --- | --- | --- |
| **F01** | **OPEN — HIGH** | Đủ 92/92 ca nguồn máy chủ và 42/42 ca Round 7 đúng kỳ vọng, gồm bốn ca từng sai. Kiểm tra số nguyên mục 4.1 tiếp tục đạt. Nhưng dòng 876 vẫn cho phép phản hồi của yêu cầu khác cùng định danh thay yêu cầu đã bắt: thêm 3 VERIFIED sai + 1 từ chối nhầm, lặp lại ở lượt xác nhận. Xem mục 4. |
| **F02** | **CLOSED** | Uploader:958–1009; sáu UPLOAD-TAIL-0/1/2 và UPLOAD-TRUNCATE-0/1/2 đều verified=0, failed=1, opens=2; lỗi tại đối chiếu toàn văn DOM. SERVER-OLD, RADIO-DRIFT, DEMO-DRIFT bị chặn; WHITESPACE đạt. Đủ nguồn Save/định danh để ca thực sự tới bước kiểm DOM. |
| **F03** | **CLOSED** | Uploader:582–606; UPLOAD-SLOT-DRIFT đổi buổi sang 13 lúc chọn radio: savedSlots=[], reqSeen=0, verified=0, failed=1. Chốt trước Save tiếp tục dừng đúng; helper điều hướng được thay có chủ đích, chưa phải nghiệm thu điều hướng LMS thật. |
| **F04** | **CLOSED** | spck-demo-score-reader.ts:624–714; AMBIGUOUS, CONFLICT, DUPLICATE đều matched=0, giữ nguyên toàn bộ bản ghi cũ. Control tên duy nhất/đủ điểm vẫn nhập được. |
| **F05** | **CLOSED** | session14-course-summary.ts:457–477, 676–744; giữ AI chờ rồi sửa/duyệt/xác minh: F05-EDIT/APPROVE/VERIFY đều CONFLICT, toàn bộ bản mới giữ nguyên. |
| **F06** | **CLOSED** | sqlite.ts:4026–4106 và kiểm trước duyệt; bảy dạng nhãn chữ/định dạng đồng bộ Demo 3,5, năng lực 3,78; thiếu/không đọc được/sửa điểm thành 99 bị chặn. Chín ca bổ sung Round 4 tiếp tục đúng. |
| **F07** | **CLOSED** | API session14-eval:95–184; thiếu/sai version, thiếu mục batch, null, chuỗi, 0, số lẻ đều HTTP 400, không đổi bản ghi. Version cũ HTTP 409, không duyệt một phần batch; batch đủ version HTTP 200. React xác nhận dừng khi lưu chờ/lỗi và lưu chữ hiển thị → duyệt version 2 → upload. |
| **F08** | **CLOSED** | final-project/page.tsx; năm nhánh load/save/import/AI/upload giữ đủ bảy trường đang sửa và lớp B. Phản hồi v2 sau v3 không kéo lùi nội dung/trạng thái; gõ khi approve/flush giữ chữ mới, WAITING_APPROVAL, contentHash rỗng. Upload cũ không đổi bản v3. |
| **F09** | **CLOSED** | session14-course-summary.ts:163–171 và xử lý prompt trước gửi; đủ Ý/ý/Y/y thành bốn STUDENT_SHORT_01, tên bạn trùng An được thay trọn cụm; không dấu/NFD không còn phần tên từng sót. Kiểm đúng payload tới model giả. |
| **F10** | **CLOSED** | spck-demo-score-reader.ts; bảng trống/thiếu B/chỉ 5 trong 20 ô E/âm/vượt trần/NaN đều matched=0, giữ toàn bộ bản cũ. Năm điểm 0 thật được nhập thành tổng 0; đủ B nhập 5, đủ E nhập 2 theo mẫu. |
| **F11** | **CLOSED** | session14-course-summary.ts; không lịch sử hoặc chỉ ABSENT/PRESENT đều INSUFFICIENT_INFO, không gọi AI; ghi chú thực nhận SUCCESS, thiếu knowledgeParagraph2 nhận ERROR. Không có câu tự suy diễn tham gia đầy đủ trong prompt. |
| **F12** | **CLOSED** | session-comments/page.tsx:187–204 và khối loadClassData; chỉ 14/15 trả ID rỗng, sessions/students rỗng và dừng trước nạp học viên; 13/14 chỉ giữ/chọn 13. |

## 4. F01 — Bốn ca cũ đã sửa đúng, nhưng chưa khóa phản hồi vào đúng yêu cầu

### 4.1. Những phần bản sửa đã đạt

Tại src/lib/playwright/session14-eval-uploader.ts:

- Dòng **865–888**: REOPEN_WINDOW_MS=6000 được dùng cho cả bộ chờ yêu cầu và bộ chờ phản hồi. Bộ chờ phản hồi bắt đầu khi nhận yêu cầu đầu tiên khớp.
- Dòng **894–903**: reopenAttempted=Boolean(reopenReq); đã bắt yêu cầu mà không có phản hồi trong 6000 ms thì ném lỗi rõ.
- Dòng **905–946**: HTTP khác 200/201, JSON hỏng, lỗi GraphQL hoặc thiếu đối tượng đánh giá đều bị chặn.
- Dòng **1013–1048**: nếu reopenAttempted=true thì xác minh reopenPayloadObj; thiếu/sai dữ liệu không chuyển sang Save. Nếu không có yêu cầu tải lại trong cửa sổ, Save đầy đủ vẫn được kiểm bằng verifyServerEvaluationPayload.
- Dòng **163–182** vẫn buộc rating máy chủ hữu hạn, là số nguyên 1..5 và bằng bản duyệt; hai ca số lẻ Round 6 và 34 ca ranh giới rating/Demo Round 7 tiếp tục đúng.

Kết quả chạy nguyên byte round7-extra.ts:

| Ca | Kỳ vọng verified | Thực chạy verified / failed | SQLite |
| --- | --- | --- | --- |
| FULLSAVE-REQUEST-450MS-FRACTIONAL | 0 | 0 / 1 | FAILED |
| FULLSAVE-REQUEST-450MS-HTTP500 | 0 | 0 / 1 | FAILED |
| FULLSAVE-REOPEN-6500MS-FRACTIONAL | 0 | 0 / 1 | FAILED |
| BAREID-REQUEST-1700MS-VALID | 1 | 1 / 0 | VERIFIED |

Cả bốn ca giữ **opens=2, requests=2, saved=true**. Hai ca fractional vẫn giữ persisted.ratings[8]=4.4, serverResponse.ratings[8]=4.4, cached.ratings[8]=4; dữ liệu không bị fixture sửa thành hợp lệ để làm đạt. Ca phản hồi 6500 ms dừng bằng lỗi “Quá thời gian chờ (6000ms) phản hồi tải lại...”, dù Save đầy đủ.

Các control REOPEN-450MS, REOPEN-5500MS-VALID, FULLSAVE-REOPEN-450MS-FRACTIONAL, BAREID-REQUEST-1000MS-VALID và REOPEN-6500MS-TIMEOUT tiếp tục đúng. Ca mới REQUEST-4500-RESPONSE-5500-VALID cũng đạt: yêu cầu bắt đầu sau 4500 ms, phản hồi sau thêm 5500 ms, xác nhận thời hạn phản hồi được tính từ lúc bắt yêu cầu, không từ lúc mở modal. Ba ca mới full Save kết hợp JSON hỏng, GraphQL errors và ID-only đều dừng ở bước tải lại, không dùng Save bỏ qua.

### 4.2. Nguyên nhân phần F01 vẫn OPEN

**Vị trí quyết định: src/lib/playwright/session14-eval-uploader.ts:874–877, đặc biệt dòng 876.**

Điều kiện nhận phản hồi hiện tại:

    res.request() === req || isMatchingReopenRequest(res.request())

Vế đầu khóa vào đúng yêu cầu đã bắt. Vế OR phía sau lại nhận bất kỳ yêu cầu nào cùng lớp/buổi/học viên và phù hợp bộ lọc nghiệp vụ. Vì thế, nếu yêu cầu A được bắt trước nhưng phản hồi chậm, phản hồi B tới sớm sẽ kết thúc bộ chờ của A.

reopenAttempted vẫn là true, và phần kiểm cuối vẫn dùng reopenPayloadObj; tuy nhiên, đó có thể là payload của B. Lỗi/timeout của A không còn được xử lý. Bản sửa đã chặn fallback sang Save nhưng chưa đáp ứng điều kiện Owner nêu rõ: **chờ phản hồi của đúng yêu cầu đã bắt**.

### 4.3. Tái hiện độc lập và control

Script mới: **probes/round8-extra.ts**, dẫn xuất từ fixture Round 7, không thay uploader hoặc hàm xác minh. Dùng customPage, **skipNavigation:false**, đúng POST/host/operation và định danh giả **studentId=S1, classId=ROUND6-SOURCE, slotNumber=14**; kho persisted tách khỏi cached.

Save trả đủ dữ liệu đúng. Khi mở lại, **A phát ngay**; **B phát sau 100 ms**. Hai yêu cầu đều GetStudentEvaluation cho cùng định danh, trừ control B sai lớp. Marker auditReq=FIRST/SECOND chỉ để phân biệt log. Với các ca lỗi, A trả sau 700 ms hoặc 6500 ms; B trả ngay khi phát. Modal giữ bản cached đúng; probe chờ thêm để thu được cả phản hồi A đến muộn.

| Ca | Điều kiện | Kỳ vọng verified | Thực chạy verified / failed | SQLite |
| --- | --- | --- | --- | --- |
| FIRST-500-SECOND-VALID | A: HTTP 500 sau 700 ms; B: đúng | 0 | 1 / 0 | VERIFIED |
| FIRST-FRACTIONAL-SECOND-VALID | A: rating 4,4 sau 700 ms; B: rating 4 | 0 | 1 / 0 | VERIFIED |
| FIRST-TIMEOUT-SECOND-VALID | A: phản hồi sau 6500 ms; B: đúng | 0 | 1 / 0 | VERIFIED |
| FIRST-VALID-SECOND-500 | A: đúng sau 700 ms; B: HTTP 500 | 1 | 0 / 1 | FAILED |
| FIRST-500-SECOND-WRONG-CLASS | A: HTTP 500; B: đúng nhưng sai lớp | 0 | 0 / 1 | FAILED |
| FIRST-VALID-SECOND-VALID | A và B đều đúng | 1 | 1 / 0 | VERIFIED |

Cả sáu ca có **opens=2, requests=3, saved=true** — một lần Save và hai lần đọc. Ca fractional giữ rating thứ chín của kho/phản hồi A là **4,4**, cached và phản hồi B là **4**. Các networkEvents lưu thời điểm yêu cầu, payload trả và sự kiện response thật của Playwright; completedAt lưu thời điểm uploader trả kết quả. Ca timeout cho thấy uploader đã VERIFIED trước khi A phản hồi sau hơn 6 giây. Lượt xác nhận còn kiểm tra trực tiếp đối tượng request: phản hồi A có sameAsFirst=true, phản hồi B có sameAsFirst=false; đây là hai yêu cầu riêng biệt, không phải hai tên gọi của cùng một yêu cầu.

Hai control xác nhận lỗi nằm ở việc chọn phản hồi: B sai lớp bị loại và lỗi A được xử lý; cả A/B đúng thì thành công. Ca A đúng/B HTTP 500 cho thấy chiều ngược lại: uploader từ chối theo lỗi B dù A hợp lệ.

Đã chạy xác nhận lại **bốn ca sai cùng hai control**, sáu lượt, kết quả giữ nguyên. Bằng chứng: round8-recheck-results.json, round8-recheck.log, round8-recheck-exit.json. Không cộng lượt lặp vào 263 ca riêng biệt.

**Ảnh hưởng:** vẫn có thể báo “đã xác minh” khi yêu cầu tải lại đã bắt trả dữ liệu khác, trả lỗi hoặc quá hạn; cũng có thể báo lỗi theo một yêu cầu khác. Giữ **F01 OPEN — HIGH**, không mở finding mới và không mở lại F02.

**Giới hạn:** đây là bằng chứng trên uploader thật với DOM/HTTP mô phỏng; chưa khẳng định LMS thật phát hai query theo các thời điểm này hoặc đã có dữ liệu thật bị sai.

### 4.4. Cách sửa nhỏ nhất và điều kiện đóng

1. Tại bộ chờ phản hồi, ràng buộc vào **chính req đã bắt**; bỏ nhánh OR nhận yêu cầu khác chỉ vì cùng định danh. Nếu dùng cách chờ khác, vẫn phải giữ đúng quan hệ yêu cầu/phản hồi và thời hạn 6000 ms từ lúc bắt yêu cầu.
2. Giữ toàn bộ bảo vệ đã đạt: cửa sổ quan sát 6000 ms, lỗi timeout/HTTP/JSON/GraphQL, không fallback Save sau khi đã bắt tải lại, kiểm đủ ba thư/chín năng lực/năm Demo, hash và chốt buổi.
3. Thêm ca hồi quy A lỗi hoặc timeout/B hợp lệ và A hợp lệ/B lỗi; giữ hai control ở mục 4.3. Bổ sung ca full Save/phản hồi 6500 ms vào bài thử trong repo.
4. Sau sửa, ba VERIFIED sai phải thành verified=0/failed=1; A đúng/B lỗi phải được xác minh theo A. Chạy lại đủ các probe hiện có và tám gates trên đúng bản sau sửa.

Không triển khai sửa trong vòng này theo yêu cầu Owner. **Chỉ GO khi F01–F12 CLOSED và 8/8 gates PASS.**

## 5. Bằng chứng chạy mới và cách tính ca

| Script tại probes/ | Số ca | Exit | Hành vi quan sát | Thời gian | Bằng chứng |
| --- | --- | --- | --- | --- | --- |
| round3-core.ts | 46 | 0 | 46/46 đúng kỳ vọng | 2,423 giây | core-results.json |
| round6-from-round3-upload.ts | 33 | 0 | 33/33 đúng kỳ vọng | 180,113 giây | upload-results.json |
| round3-ui.ts | 17 | 0 | 17/17 đúng kỳ vọng | 7,291 giây | ui-results.json |
| round3-selector.ts | 3 | 0 | 3/3 đúng kỳ vọng | 1,304 giây | selector-results.json |
| round4-upload-extra.ts | 3 | 0 | 3/3 đúng kỳ vọng | 25,336 giây | upload-extra-results.json |
| round4-ui-extra.ts | 2 | 0 | 2/2 đúng kỳ vọng | 3,254 giây | ui-extra-results.json |
| round4-score-extra.ts | 9 | 0 | 9/9 đúng kỳ vọng | 1,605 giây | score-extra-results.json |
| round6-from-round5-upload-closure.ts | 6 | 0 | 6/6 đúng kỳ vọng | 49,905 giây | upload-closure-results.json |
| round6-server-source.ts | 92 | 0 | 92/92 đúng kỳ vọng | 443,852 giây | server-source-results.json |
| round7-extra.ts | 42 | 0 | 42/42 đúng kỳ vọng | 238,042 giây | round7-extra-results.json |
| round8-extra.ts | 10 | 0 | 6 đúng; 3 VERIFIED sai; 1 từ chối nhầm | 56,597 giây | round8-extra-results.json |
| round8-recheck.ts | 6 lượt lặp | 0 | Giữ nguyên 4 sai + 2 control | 29,107 giây | round8-recheck-results.json |

Tổng được yêu cầu **253/253 đúng kỳ vọng**. Thêm 10 ca Round 8, trong đó 6 đúng và 4 sai: **263 ca riêng biệt / 259 đúng kỳ vọng**. Sáu lượt xác nhận lại và lượt chuẩn bị fixture không cộng vào tổng.

Các probe Round 7 cùng hai bản uploader thích nghi từ Round 6 được sao chép nguyên byte; không sửa kỳ vọng cũ để làm đạt. Đã đối chiếu hash của đủ 13 script đầu vào từ thư mục Round 7. Các tệp Round 4/5/6/7 gốc giữ nguyên.

**Minh bạch chuẩn bị fixture mới:** lượt đầu ba ca full Save + JSON lỗi/GraphQL errors/ID-only áp dụng biến thể lỗi cả vào phản hồi Save, nên dừng trước tải lại. Không dùng ba kết quả ấy để chứng minh nhánh tải lại. Đã giới hạn biến thể vào isLoad **chỉ trong probe TEMP**, rồi chạy lại nguyên 10 ca. Kết quả cuối của cả ba ca có opens=2, requests=2 và lỗi tại tải lại. Giữ round8-extra-initial.ts, round8-extra-initial-results.json, round8-extra-initial.log và round8-extra-initial-exit.json để đối chiếu. Bốn ca ghép nhầm phản hồi đã tái hiện ở cả lượt đầu, lượt cuối và lượt xác nhận.

**Exit 0 của probe chỉ nghĩa chương trình quan sát hoàn tất, không tự nghĩa mọi hành vi sản phẩm PASS.** verify-evidence.mjs đối chiếu độc lập kỳ vọng và các điều kiện quan trọng, gồm trạng thái SQLite, nguồn dữ liệu, điểm fractional, toàn văn DOM, thứ tự yêu cầu và tính lặp lại; ghi evidence-summary.json với **NO-GO, 3 falseVerified, 1 falseRejected**. Đây là bước tổng hợp bằng chứng, không phải gate thứ chín.

## 6. Dấu bản mã và tính nguyên vẹn

SHA-256 — dấu kiểm tra nội dung — của các tệp trọng tâm thực kiểm:

| Tệp | SHA-256 |
| --- | --- |
| src/app/final-project/page.tsx | 0f3b9ad7a6e7391b8007f87e1e5c76eca1f108f2dab61ee902d6aad64dd3d84e |
| src/app/session-comments/page.tsx | ac7e9d1f780cb5568ea0c721968cb2122157599590e1684f65ce2ead45472817 |
| src/app/api/spck/session14-eval/route.ts | 3d057b0bd3078bddcc6861ccb095ff71ccfc2c44ed39ebc99b607afbb3a82cc7 |
| src/lib/db/sqlite.ts | 422d639af47b7dbacb84738cf4cfab117d1bed2913d8fe363a11773db00e02af |
| src/lib/gemini/session14-course-summary.ts | e90a0ee42368508257fd89950cb73921e07f91d1e2bd1a4124c9be7a68c0dc80 |
| src/lib/local-files/spck-demo-score-reader.ts | 0f4e0e3bc44b565114104dc7620f61abacb1fc205ac8a5ad069783c1b59fd56a |
| src/lib/playwright/session14-eval-uploader.ts | d8db591669fdff0d404f237f69c7abf5cfc7ca9b271c0f14126925467ea27b46 |
| scripts/test-session14-v290.ts | 1a98bc415226be40c44a59738ad030270a3494b92ac6c42a973bd829140772b9 |
| next-env.d.ts | b8b3a344484b959af5e4e3fc1a1609dac3cb9ece0cdeb6c145be29bc4c491000 |

manifest.json, round7-source-delta.json và các integrity-*.json lưu đầu vào, hai thay đổi so Round 7 và đối chiếu trước/sau. git-before.txt, git-after.txt và report-validation.json xác nhận báo cáo này là thay đổi repo duy nhất do Round 8 tạo ra.

**Dọn bản sao:** đã xác nhận đường dẫn tuyệt đối thuộc đúng workspace Round 8, lập danh sách từng tệp/thư mục và không đi theo liên kết thư viện. Gỡ riêng liên kết node_modules rồi xóa từng tệp/thư mục rỗng. cleanup-result.json xác nhận **workspaceRemoved=true**, xóa **146 tệp / 77 thư mục**, giữ **16 script**, thư viện gốc vẫn còn. Không giữ DB thử; bốn thư mục vòng trước không bị sửa hoặc dọn.

## 7. Giới hạn và bàn giao

- Không đăng nhập, đọc danh sách học viên thật hoặc ghi LMS thật; không gọi Gemini/Google Sheets riêng tư/Drive/GitHub thật. Không dùng nghiệm thu lịch sử v270/v272/v280 làm nghiệm thu v290.
- Uploader dùng DOM/HTTP mô phỏng, một browser context mỗi tiến trình; helper điều hướng được thay để cô lập chốt buổi. UI chạy handler trích nguyên trạng trong React/ReactDOM/Chromium, chưa phải toàn bộ trang Next.js hoặc modal LMS thật.
- Chưa chạy build phát hành, chưa xác nhận hợp đồng mutation/query, thứ tự trường và cơ chế tải lại trên LMS thật. Các giới hạn này được ghi riêng, không dùng để phủ nhận các ca đã CLOSED hoặc ghi thành PASS.
- Bằng chứng TEMP có thể bị hệ điều hành dọn; đầu vào, kết quả quyết định và hướng sửa đã ghi trực tiếp trong báo cáo.

**Đã làm:** đọc đủ bảy báo cáo trước; kiểm định bản sửa, chạy tám gates, 263 ca riêng biệt và sáu lượt xác nhận; chỉ thêm báo cáo Round 8.

**Kết quả:** **NO-GO — 11 CLOSED / 1 OPEN (F01); 8/8 gates PASS. Bốn ca lỗi Round 7 đã đạt; điều kiện ghép đúng yêu cầu/phản hồi vẫn chưa đạt.**

**Chưa kiểm tra:** LMS/Gemini và dữ liệu thật, build phát hành, toàn bộ giao diện thật.

**Việc tiếp theo:** bên triển khai sửa duy nhất việc ghép phản hồi theo mục 4.4, bổ sung ca hồi quy rồi kiểm định lại. Owner không cần thao tác Terminal hoặc cung cấp tài khoản cho vòng này.

