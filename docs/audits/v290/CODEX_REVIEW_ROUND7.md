# v2.9.0 — Round 7 Final Verification Audit — Buổi 14

Ngày kiểm định: **27/10/2026, UTC+7**. Reviewer: **Codex, trực tiếp thực hiện vai trò Independent Code & Quality Reviewer theo yêu cầu Owner**.

**Overall Verdict: NO-GO.** Đã chạy mới đủ **8/8 verification gates: PASS, exit code 0**, cùng **253 trường hợp riêng biệt: 119 ca cũ + đủ 92 ca nguồn máy chủ Round 6 + 42 ca bổ sung**. **F02–F12 CLOSED; F01 OPEN (HIGH)**. Phần **4.1 của Round 6 đã được sửa đúng**: điểm năng lực 4,4 không còn được làm tròn thành 4. Phần **4.2 chưa đóng hoàn toàn**: thời gian chờ phản hồi đã tăng lên 6000 ms, nhưng thời gian bắt đầu nhận yêu cầu tải lại vẫn chỉ 350/1500 ms; hết hạn phản hồi còn có thể bị bỏ qua nếu Save đã trả đủ dữ liệu.

Đã tái hiện **3 ca VERIFIED sai và 1 ca từ chối nhầm**, rồi chạy lại cùng 2 control: kết quả giữ nguyên. Không sửa mã ứng dụng, bài thử hoặc next-env.d.ts. Trong repo chỉ thêm báo cáo này.

## 1. Phạm vi, bản mã và bảo vệ dữ liệu

- Đọc PROJECT_STATE.md đầu tiên; đọc đủ CODEX_REVIEW_ROUND1.md đến CODEX_REVIEW_ROUND6.md trước khi chạy kiểm định. Đối chiếu AGENTS.md, MINDX_AUTOMATION_PLAN.md, CHANGELOG.md, mã xử lý và nơi gọi.
- HEAD: **eeb73d31d51e5915b52ebbcea377aeee5c7384c1**. Kết luận áp dụng cho toàn bộ bản mã thư mục làm việc đã chụp, gồm tệp chưa được Git theo dõi; không chỉ nội dung commit. Khi bắt đầu có 22 tệp được theo dõi đã sửa cùng các đường dẫn mới v280/v290. Giữ nguyên công việc có sẵn, không commit/reset/đổi HEAD.
- So với manifest Round 6, đúng **hai đầu vào thay đổi**: src/lib/playwright/session14-eval-uploader.ts và scripts/test-session14-v290.ts. Các đầu vào khác giữ nguyên hash.
- Chạy tuần tự tám lệnh và các probe trong bản sao TEMP có **128 tệp đầu vào**. Kiểm tra không thiếu tệp .ts/.tsx/.json trong src/ và scripts/ so với bản gốc.
- Không sao chép .env/.env.local, SQLite thật, playwright-auth hoặc teacher_browsed_dirs.json. Dùng dữ liệu/học viên giả, **GEMINI_API_KEY=ROUND7_SYNTHETIC_KEY**; bỏ LMS_PASSWORD và TEACHING_PASSWORD khỏi tiến trình thử. AI và HTTP nghiệp vụ được mô phỏng.
- Dùng thư viện đã cài qua junction node_modules — liên kết tới thư viện hiện có; không cài/cập nhật thư viện. Môi trường: Windows, Node **v24.21.0**, npm **11.19.0**.
- Đối chiếu trước/sau xác nhận **128/128 đầu vào gốc và 128/128 đầu vào bản sao không đổi**. Kiểm tra riêng **19 đường dẫn được bảo vệ**: AGENTS.md, ba tài liệu trạng thái, next-env.d.ts, tsconfig.tsbuildinfo, .env.local, các đường dẫn DB/cấu hình riêng và sáu báo cáo trước; trạng thái tồn tại và hash không đổi.
- Đối chiếu toàn bộ **157 tệp bằng chứng** có sẵn trong mindx-v290-round4-lu6e9k, mindx-v290-round5-6z0KJG và mindx-v290-round6-3Vlx5e: không thay đổi tệp nào. Các probe cũ chỉ được đọc/sao chép vào Round 7.
- Quy mô đánh giá: ứng dụng cục bộ cho một giáo viên; có mạng chậm, phản hồi đảo thứ tự, gõ tiếp lúc lưu và chuyển lớp.

Thư mục bằng chứng mới:

    C:/Users/QQ/AppData/Local/Temp/mindx-v290-round7-5db1c4/

Các lệnh được chạy trong workspace/ bên trong đường dẫn này. **Đã xóa toàn bộ workspace và DB thử trước khi kết thúc**; giữ scripts, log, JSON và manifest ở ngoài workspace. Ba thư mục vòng trước được giữ nguyên.

## 2. Verification Gate Table — đủ 8 lệnh và exit code

Đợt chạy **15:17:05–15:20:51 ngày 27/10/2026, UTC+7**. Mỗi lệnh chạy một lần, PASS ngay lượt đầu; không sửa bài thử để làm cổng đạt.

| STT | Lệnh nguyên trạng | Kết quả | Exit code | Thời gian | Bằng chứng |
| --- | --- | --- | --- | --- | --- |
| 1 | npx tsc --noEmit | **PASS** | **0** | 26,097 giây | gate-1.log, không có chẩn đoán lỗi |
| 2 | npx tsx scripts/test-session14-v290.ts | **PASS** | **0** | 69,413 giây | gate-2.log, đủ S14-01–S14-07 |
| 3 | npx tsx scripts/test-lms-reliability-v280.ts | **PASS** | **0** | 82,164 giây | gate-3.log, đủ T280-01–T280-05 |
| 4 | npx tsx scripts/test-spck-v270.ts | **PASS** | **0** | 5,370 giây | gate-4.log, đủ T01–T16 |
| 5 | npx tsx scripts/test-spck-v272.ts | **PASS** | **0** | 28,372 giây | gate-5.log, đủ V01–V16 |
| 6 | npx tsx scripts/test-phase5.ts | **PASS** | **0** | 3,263 giây | gate-6.log |
| 7 | npx tsx scripts/test-phase6.ts | **PASS** | **0** | 9,519 giây | gate-7.log |
| 8 | npx tsx scripts/test-phase7.ts | **PASS** | **0** | 1,216 giây | gate-8.log |

gates.json lưu thời điểm, thời gian, exit code và tên log từng lệnh.

**Đánh giá bài thử đã bổ sung:** S14-07 có save-fractional, reopen-fractional, save-out-of-range-0, reopen-out-of-range-6, save-wrong-int, reopen-wrong-int và reopen-450ms-valid; tất cả đạt. Tuy nhiên, các ca này tách nguồn Save/tải lại và chủ yếu trì hoãn **phản hồi của yêu cầu đã phát ngay**. Chúng chưa bao phủ yêu cầu chỉ bắt đầu sau 450 ms khi Save trả đủ dữ liệu, hoặc việc bỏ qua timeout tải lại khi có nguồn Save đầy đủ. Phần cuối mang tên F07, F08 & F12 vẫn không thay thế kiểm tra handler React; các probe độc lập bên dưới chạy handler thật cho F07/F08.

## 3. Status Table — F01 đến F12

**CLOSED** nghĩa là đã kiểm chứng ranh giới lỗi trên dữ liệu giả của bản mã này. Chưa có nghiệm thu LMS/Gemini thật. Giữ số finding ban đầu; các biến thể của cùng ranh giới F01 không được đánh số thành lỗi mới.

| ID | Trạng thái | Bằng chứng kiểm chứng mới |
| --- | --- | --- |
| **F01** | **OPEN** | **92/92 ca Round 6 đúng kỳ vọng**; SAVE/REOPEN-FRACTIONAL-RATING nay verified=0, failed=1. Các control mảng/trường tên/đối tượng lồng, HTTP 200/201 và REOPEN-450MS đều đạt; bare ID không có nguồn đầy đủ, cache/closure và ca mạng sai đều bị chặn. Tuy nhiên, 42 ca mới có **3 VERIFIED sai và 1 từ chối nhầm**, đều lặp lại; xem mục 4. Điểm 4.1 Round 6 đã đóng; ranh giới thời gian chờ 4.2 còn mở. |
| **F02** | **CLOSED** | src/lib/playwright/session14-eval-uploader.ts:950–995. Đủ sáu UPLOAD-TAIL-0/1/2 và UPLOAD-TRUNCATE-0/1/2: verified=0, failed=1, opens=2, lỗi ghi rõ đối chiếu toàn văn trên DOM — các ô hiển thị. SERVER-OLD, RADIO-DRIFT, DEMO-DRIFT cũng bị chặn tại DOM; WHITESPACE verified=1. Request đủ định danh, control Save trả dữ liệu đầy đủ, nên không đóng lỗi chỉ vì dừng ở kiểm tra mạng. |
| **F03** | **CLOSED** | Chốt hash/buổi trước Save tại uploader:582–606. UPLOAD-SLOT-DRIFT đổi buổi sang 13 trong khi chọn radio: **savedSlots=[], reqSeen=0, verified=0, failed=1**. Helper được thay có chủ đích để báo lỗi khi sai buổi; đây là bằng chứng chốt trước Save, chưa phải nghiệm thu điều hướng LMS thật. |
| **F04** | **CLOSED** | src/lib/local-files/spck-demo-score-reader.ts:624–714. AMBIGUOUS, CONFLICT, DUPLICATE đều matched=0 và **giữ nguyên toàn bộ bản ghi cũ**. Các control tên duy nhất/đủ điểm vẫn nhập đúng. |
| **F05** | **CLOSED** | src/lib/gemini/session14-course-summary.ts:457–477, 676–744. Giữ AI chờ rồi sửa/duyệt/xác minh bản mới: F05-EDIT/APPROVE/VERIFY đều **CONFLICT**, toàn bộ bản ghi mới không đổi. Đã đối chiếu kiểm tra lại version/trạng thái và expectedVersion khi lưu. |
| **F06** | **CLOSED** | src/lib/db/sqlite.ts:4026–4106 và chốt trước duyệt. Bảy dạng PLAIN/BOLD/BULLET/UNDERLINE/TILDE/SPLIT/NUMBERED đồng bộ Demo **3,5**, năng lực **3,78** rồi duyệt được; BOLD-TAMPER, UNPARSEABLE, MISSING-LINES bị từ chối. Chín ca Round 4: sáu tiền tố -, *, •, +, 1., 2) kết hợp nhãn định dạng đều đồng bộ; thiếu riêng một dòng hoặc sửa điểm thành 99 đều bị chặn. |
| **F07** | **CLOSED** | src/app/api/spck/session14-eval/route.ts:95–184. Thiếu/sai version, bản đồ thiếu học viên/thiếu mục batch, null, chuỗi, 0, số lẻ đều HTTP **400**, bản ghi không đổi. Ba ca version cũ HTTP **409**, không duyệt một phần batch; batch đủ version HTTP **200**, hai bản APPROVED. React thật xác nhận không approve/upload khi lưu còn chờ hoặc lỗi; control đúng lưu chữ hiển thị → duyệt expectedVersions.S1=2 → upload. |
| **F08** | **CLOSED** | src/app/final-project/page.tsx, năm nhánh load/save/import/AI/upload: cả năm ca gõ giữ đủ **bảy trường chỉnh sửa**, cả năm ca đổi lớp giữ lớp B. Load đảo thứ tự giữ **v3 / NEW SERVER V3**; AI/import v2 trả muộn giữ **v3 / OLD LETTER / VERIFIED**. Upload v2 trả sau v3 giữ toàn bộ bản v3, gồm hash/ghi chú. Gõ khi approve hoặc flush giữ chữ mới, WAITING_APPROVAL, contentHash rỗng khi upload trả VERIFIED cũ. |
| **F09** | **CLOSED** | src/lib/gemini/session14-course-summary.ts:163–171 và xử lý prompt trước generateContent. Bắt đúng nội dung gửi model giả: cả **Ý/ý/Y/y** thành bốn STUDENT_SHORT_01; bạn cùng tên An được thay trọn họ tên thành PEER_STUDENT. Ca không dấu/NFD không còn tên đầy đủ hoặc phần họ đệm từng sót. |
| **F10** | **CLOSED** | spck-demo-score-reader.ts:165–245, 692. Bảng trống, thiếu B, chỉ 5/20 ô E, điểm âm/vượt trần và NaN: matched=0, toàn bộ bản ghi cũ không đổi. Năm số 0 thật nhập tổng **0**; đủ B nhập **5**, đủ E nhập **2** theo dữ liệu mẫu. |
| **F11** | **CLOSED** | session14-course-summary.ts, chốt dữ kiện và trường AI bắt buộc. Không lịch sử, chỉ ABSENT hoặc PRESENT: **INSUFFICIENT_INFO, 0 lời gọi AI**. Có ghi chú thực: SUCCESS; thiếu knowledgeParagraph2: ERROR. Không có câu suy diễn tham gia đầy đủ các hoạt động thực hành trong prompt đã bắt. |
| **F12** | **CLOSED** | src/app/session-comments/page.tsx:187–204 và khối loadClassData. Hàm thật trả ID rỗng khi chỉ có 14/15, chọn 13 khi có 13/14. Nguyên khối lọc/nạp buổi với chỉ 14/15 đặt **sessions=[], students=[], selected rỗng**, dừng trước nạp học viên; 13/14 chỉ giữ và chọn 13. |

## 4. F01 — HIGH — Còn bỏ qua yêu cầu/phản hồi tải lại khi chờ mạng

### 4.1. Phần kiểm tra số đã được sửa đúng

Tại **src/lib/playwright/session14-eval-uploader.ts:163–182**, giá trị năng lực máy chủ phải hữu hạn, là số nguyên trong 1..5 và bằng đúng bản duyệt. Không còn Math.round trên actualRating.

- Hai ca cũ SAVE-FRACTIONAL-RATING / REOPEN-FRACTIONAL-RATING nay **verified=0, failed=1, SQLite FAILED**. Kho lưu/phản hồi vẫn là **4,4**, còn bản duyệt và radio trong modal là **4**; không phải fixture đã tự sửa đầu vào.
- Thêm trên cả hai nguồn Save/tải lại: 0, 6, -1, 4,01, sai số nguyên 1, boolean, chuỗi trống, null và Infinity đều bị từ chối. Chuỗi số hợp lệ 4 vẫn được nhận theo cách chuẩn hóa hiện có.
- Điểm Demo máy chủ âm, vượt trần, boolean, trống, Infinity hoặc lệch 0,00001 đều bị từ chối. Control sai số nhỏ nằm trong epsilon 0,000001 được nhận đúng giới hạn hiện tại.
- REOPEN-450MS cũ và REOPEN-5500MS-VALID đều **verified=1, failed=0** khi yêu cầu bắt đầu ngay và phản hồi hợp lệ về trong 6000 ms. REOPEN-6500MS-TIMEOUT chỉ có Save ID bị từ chối đúng.

Như vậy **mục 4.1 Round 6 CLOSED**. Các ca 4,4 lọt ở phần dưới đi vòng qua bước xác minh phản hồi tải lại; không phải hàm kiểm tra số nguyên vẫn làm tròn.

### 4.2. Nguyên nhân phần còn mở

**Vị trí chính:** src/lib/playwright/session14-eval-uploader.ts:**864–890**, đặc biệt **873**, **877–882**, **887–888**. Nguồn Save được dùng để tiếp tục tại **999–1029**; đánh dấu VERIFIED tại **356–366**.

Luồng hiện tại:

    waitForRequest(..., timeout: saveHasFullFields ? 350 : 1500)
    waitForResponse(..., timeout: 6000).catch(() => null)
    reopenResponse = reopenReq ? await reopenResponsePromise : null

Có hai nhánh lỗi cùng ranh giới thời gian chờ:

1. **Yêu cầu bắt đầu muộn bị loại trước khi chờ phản hồi.** Khi Save có đủ dữ liệu, yêu cầu tải lại phát sau **450 ms** đã quá cửa sổ **350 ms**. Dù bộ chờ phản hồi bắt được phản hồi, reopenReq đã là null nên phản hồi ấy không được xử lý. Save đủ dữ liệu vẫn làm hasVerifiedServerSource=true. Khi Save chỉ trả ID, cửa sổ tương ứng là **1500 ms**: một yêu cầu hợp lệ bắt đầu ở **1700 ms**, vẫn trong 6000 ms, bị bỏ lỡ và báo thiếu nguồn.
2. **Request đã bắt được nhưng response timeout cũng bị bỏ qua.** Nếu yêu cầu phát ngay nhưng phản hồi chậm **6500 ms**, timeout biến thành null. Không có lỗi bắt buộc dừng; khi Save đầy đủ, code dùng nguồn Save và vẫn VERIFIED, dù lần tải lại chưa được xác minh.

Tăng riêng thời gian waitForResponse không bảo đảm mọi yêu cầu phát sinh khi mở lại đều được chờ và kiểm tra. Ca 450 ms ở đây khác ca cũ: **trì hoãn thời điểm phát yêu cầu**, không chỉ trì hoãn phản hồi của một yêu cầu đã phát ngay.

### 4.3. Tái hiện trên đúng uploader hiện tại

Script mới tại TEMP: **probes/round7-extra.ts**, dẫn xuất từ round6-server-source.ts; không thay hàm uploader hoặc hàm xác minh. Mọi ca dùng customPage, **skipNavigation:false**, đúng POST/host/operation/định danh **studentId=S1, classId=ROUND6-SOURCE, slotNumber=14**. Giữ mã lớp giả cũ để tái sử dụng fixture; không dùng lớp thật.

Bản duyệt có ba thư đầy đủ, Demo [1.5,1,0.5,1,1], chín rating 4. Kho persisted và bản nháp cached nằm trong bộ nhớ riêng của fixture, tách khỏi nhau. Với fullSave, phản hồi Save trả bản đầy đủ đúng tại thời điểm Save. Khi tải lại, fixture mô phỏng máy chủ trả/lưu rating thứ 9 là 4,4 hoặc trả HTTP 500; modal vẫn dựng từ cached có radio 4. Đây là kiểm tra phản hồi tải lại bất đồng nhất với Save, không phải ca không hề lưu.

| Ca | Điều kiện tải lại sau khi mở modal | Kỳ vọng | Kết quả thực chạy |
| --- | --- | --- | --- |
| **FULLSAVE-REQUEST-450MS-FRACTIONAL** | Save đầy đủ; bắt đầu query sau 450 ms, trả ngay rating 4,4 | Từ chối rating khác bản duyệt | **verified=1, failed=0, SQLite VERIFIED** |
| **FULLSAVE-REQUEST-450MS-HTTP500** | Save đầy đủ; bắt đầu query sau 450 ms, HTTP 500 | Dừng vì tải lại lỗi | **verified=1, failed=0, SQLite VERIFIED** |
| **FULLSAVE-REOPEN-6500MS-FRACTIONAL** | Save đầy đủ; query bắt đầu ngay, phản hồi sau 6500 ms, rating 4,4 | Dừng khi hết hạn 6000 ms | **verified=1, failed=0, SQLite VERIFIED** |
| **BAREID-REQUEST-1700MS-VALID** | Save ID; bắt đầu query sau 1700 ms, trả ngay toàn bộ dữ liệu đúng | Chờ và xác minh trong cửa sổ 6000 ms | **verified=0, failed=1, SQLite FAILED**; báo không có nguồn máy chủ |

Cả bốn ca đều có **opens=2, requests=2, saved=true**. Hai ca fractional giữ đủ bằng chứng **persisted.ratings[8]=4.4, serverResponse.ratings[8]=4.4, cached.ratings[8]=4**. Probe chờ thêm sau khi uploader trả kết quả để thu được cả phản hồi trễ; không kết luận dữ liệu thiếu chỉ vì chưa chờ fixture hoàn tất.

Control trong cùng fixture:

- **FULLSAVE-REOPEN-450MS-FRACTIONAL:** query phát ngay, chỉ response trễ 450 ms → **verified=0, failed=1** đúng. Khi request được bắt, kiểm tra số nguyên hoạt động.
- **BAREID-REQUEST-1000MS-VALID:** query phát sau 1000 ms, còn trong cửa sổ 1500 ms → **verified=1, failed=0**.
- **REOPEN-5500MS-VALID:** response hợp lệ sau 5500 ms → **verified=1, failed=0**.
- **REOPEN-6500MS-TIMEOUT:** Save chỉ có ID, response sau 6500 ms → **verified=0, failed=1** đúng.

Đã chạy xác nhận lại **bốn ca sai + hai control đầu**, **6 lượt**, exit **0**, kết quả giữ nguyên. Lần xác nhận: **15:29:57–15:30:33**, UTC+7; recheck-exit.json, round7-recheck-results.json và round7-recheck.log.

**Ảnh hưởng:** có thể báo đã xác minh dù nguồn tải lại chứa điểm khác/không hợp lệ hoặc đang lỗi; chiều ngược lại có thể báo thất bại với dữ liệu đúng chỉ vì yêu cầu phát chậm. Giữ **F01 OPEN, HIGH**, không mở lại F02 vì lỗi nằm ở việc chọn/chờ nguồn máy chủ.

**Giới hạn:** đây là bằng chứng trên uploader thật với DOM/HTTP giả lập, chưa khẳng định LMS thật hiện lưu 4,4, phát query theo các thời điểm này hay đã có sai dữ liệu thật.

### 4.4. Cách sửa tối thiểu và điều kiện đóng

Đồng nhất thời gian quan sát yêu cầu tải lại với cửa sổ hợp lý 6000 ms, rồi chờ đúng phản hồi của yêu cầu đã bắt trong thời hạn quy định. Phân biệt rõ không có yêu cầu tải lại với đã có yêu cầu nhưng timeout/lỗi. **Đã phát sinh tải lại mà hết hạn, HTTP lỗi hoặc dữ liệu không khớp thì phải dừng; không được dùng Save để bỏ qua kết quả ấy.** Giữ nguồn Save đầy đủ như phương án hợp lệ khi không có lần tải lại cần xử lý.

Giữ toàn bộ kiểm tra số nguyên, định danh, HTTP 200/201, mutation, toàn văn, hash và chốt buổi trước Save đã đạt. Không cần thay đổi F02–F12.

Sau sửa, ba ca VERIFIED sai phải **verified=0, failed=1**; BAREID-REQUEST-1700MS-VALID phải đạt trong cửa sổ 6000 ms. Giữ các control tải ngay/450/1000/5500 ms và timeout thật, chạy lại đủ 119 + 92 ca cùng tám gates. **Chỉ GO khi F01–F12 CLOSED và 8/8 gates PASS trên đúng bản sau sửa.**

## 5. Bằng chứng chạy mới và số lượng ca

Các probe chính chạy **15:21:01–15:29:18, UTC+7**. Cả **10 script hoàn tất ngay lượt đầu, exit 0**; không sửa fixture sau lỗi thực thi. Các probe cũ được sao chép nguyên byte từ Round 6, bao gồm hai bản thích nghi uploader đã dùng ở vòng đó; không đổi kỳ vọng cũ để làm ca đạt.

| Script tại probes/ | Số ca riêng biệt | Exit code | Bằng chứng |
| --- | --- | --- | --- |
| round3-core.ts | 46 | **0** | core-results.json: F04–F07, F09–F12 |
| round6-from-round3-upload.ts | 33 | **0** | upload-results.json: định danh/mạng, toàn văn DOM, radio/điểm/buổi, control 200/201 |
| round3-ui.ts | 17 | **0** | ui-results.json: handler nguyên trạng trong React/ReactDOM/Chromium, F07/F08 |
| round3-selector.ts | 3 | **0** | selector-results.json: khối lọc/nạp buổi thật |
| round4-upload-extra.ts | 3 | **0** | upload-extra-results.json: cache cũ bị từ chối |
| round4-ui-extra.ts | 2 | **0** | ui-extra-results.json: gõ khi flush, upload cũ trả sau bản mới |
| round4-score-extra.ts | 9 | **0** | score-extra-results.json: nhãn/điểm trong thư |
| round6-from-round5-upload-closure.ts | 6 | **0** | upload-closure-results.json: hai control đạt, kho cũ/ba closure bị chặn |
| **Tổng ca cũ** | **119** | | **Đúng kỳ vọng** |
| round6-server-source.ts | 92 | **0** | server-source-results.json: **92/92 đúng kỳ vọng**, chạy toàn bộ script nguyên byte, không dùng lọc ca |
| round7-extra.ts | 42 | **0** | round7-extra-results.json: **38 đúng kỳ vọng, 3 VERIFIED sai, 1 từ chối nhầm** |
| **Tổng riêng biệt** | **253** | | **249 đúng kỳ vọng / 4 sai** |

42 ca mới gồm: **20 ca năng lực**, **14 ca Demo** trên cả hai nguồn và **8 ca thời gian chờ/kết hợp nguồn**. Sáu lượt xác nhận lại không cộng vào 253 ca riêng biệt.

**Exit 0 của probe chỉ nghĩa chương trình quan sát chạy xong và ghi kết quả. Không đồng nghĩa mọi hành vi sản phẩm PASS.** verify-evidence.mjs kiểm tra độc lập kết quả/điều kiện của 119 ca cũ, đủ 92 ca nguồn máy chủ, 42 ca mới và tính lặp lại của sáu lượt xác nhận; exit 0, ghi evidence-summary.json với **NO-GO, falseVerified=3, falseRejected=1**. Đây là bước tổng hợp bằng chứng, không phải gate thứ chín.

Mã probe mới chỉ thay fixture để thêm dữ liệu không hợp lệ, phát query trễ, trả Save đầy đủ đồng thời có tải lại, và ghi thời gian/kết quả. Không thay ứng dụng. prepare-extra.mjs giữ cách dẫn xuất; các script thực chạy được giữ tại probes/. probes-exits.json, recheck-exit.json và từng log ghi đủ thời điểm, thời gian và exit code.

## 6. Dấu bản mã, tính nguyên vẹn và dọn dữ liệu thử

SHA-256 — dấu kiểm tra nội dung — của các tệp trọng tâm thực kiểm:

| Tệp | SHA-256 |
| --- | --- |
| src/app/final-project/page.tsx | 0f3b9ad7a6e7391b8007f87e1e5c76eca1f108f2dab61ee902d6aad64dd3d84e |
| src/app/session-comments/page.tsx | ac7e9d1f780cb5568ea0c721968cb2122157599590e1684f65ce2ead45472817 |
| src/app/api/spck/session14-eval/route.ts | 3d057b0bd3078bddcc6861ccb095ff71ccfc2c44ed39ebc99b607afbb3a82cc7 |
| src/lib/db/sqlite.ts | 422d639af47b7dbacb84738cf4cfab117d1bed2913d8fe363a11773db00e02af |
| src/lib/gemini/session14-course-summary.ts | e90a0ee42368508257fd89950cb73921e07f91d1e2bd1a4124c9be7a68c0dc80 |
| src/lib/local-files/spck-demo-score-reader.ts | 0f4e0e3bc44b565114104dc7620f61abacb1fc205ac8a5ad069783c1b59fd56a |
| src/lib/playwright/session14-eval-uploader.ts | ceb1cd1418b13ddb2bc40d8fab1c1151d233086b70e6067f0e4573069bd510c7 |
| scripts/test-session14-v290.ts | ef259941311987ac531b3a935a3d21306075c7b3e140f56f846d331ce381f3f7 |
| next-env.d.ts | b8b3a344484b959af5e4e3fc1a1609dac3cb9ece0cdeb6c145be29bc4c491000 |

manifest.json, round6-source-delta.json, integrity-midrun.json, integrity-before-cleanup.json và integrity-final.json giữ danh sách đầu vào/kết quả đối chiếu. git-before.txt và git-after.txt ghi trạng thái đầy đủ; báo cáo này là thay đổi repo duy nhất do vòng kiểm định tạo ra.

**Dọn workspace:** kiểm tra đường dẫn tuyệt đối đúng workspace Round 7, lập danh sách từng tệp/thư mục, không đi theo junction; gỡ riêng liên kết node_modules rồi xóa từng tệp/thư mục rỗng. cleanup-result.json xác nhận **workspaceRemoved=true**, đã xóa **144 tệp / 77 thư mục**, giữ **13 script** tại probes/, thư viện gốc vẫn còn. Không giữ DB/dữ liệu thử trong thư mục bằng chứng. Các thư mục Round 4/5/6 không bị sửa hoặc dọn.

## 7. Giới hạn và bàn giao

- Không đăng nhập, đọc danh sách học viên thật hoặc ghi LMS thật; không gọi Gemini/Google Sheets riêng tư/Drive/GitHub thật. Không dùng nghiệm thu lịch sử v270/v272/v280 để suy ra nghiệm thu mới v290.
- Uploader dùng DOM/HTTP mô phỏng, một browser context trong mỗi tiến trình; helper điều hướng được thay để cô lập chốt buổi. Probe UI chạy handler trích nguyên trạng trong React thật; chưa phải toàn bộ trang Next.js hoặc modal LMS thật.
- Chưa chạy build phát hành; chưa xác nhận hợp đồng mutation/query, thứ tự trường và cơ chế tải lại học bạ trên LMS thật. Không ghi các phần chưa nghiệm thu thành PASS.
- Các tệp TEMP có thể bị hệ điều hành dọn; đầu vào, kết quả, vị trí mã và hướng sửa quyết định đã được ghi trực tiếp trong báo cáo.

**Đã làm:** kiểm định F01–F12, chạy mới tám gates, 253 ca riêng biệt và sáu lượt xác nhận; chỉ thêm báo cáo, đã dọn workspace thử.

**Kết quả:** **NO-GO — 11 CLOSED / 1 OPEN (F01); 8/8 gates PASS, exit code 0. Mục 4.1 Round 6 đã đạt; mục 4.2 còn hở.**

**Chưa kiểm tra:** dịch vụ/dữ liệu thật, build phát hành và toàn bộ giao diện thật.

**Việc tiếp theo:** bên triển khai sửa ranh giới chờ yêu cầu/phản hồi và chặn fallback Save khi tải lại đã phát sinh nhưng lỗi/hết hạn theo mục 4.4, rồi kiểm định lại. Owner không cần thao tác Terminal hoặc cung cấp tài khoản cho vòng này.
