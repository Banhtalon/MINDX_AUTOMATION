# AUDIT-R21 — Kiểm toán độc lập Giai đoạn 5

**Phán quyết chính thức: NO-GO cấp mã nguồn. Chưa nghiệm thu Giai đoạn 5.**

Bộ Vòng 20 nguyên bản hiện đạt **145/145**. Tuy nhiên, 49 ca bổ sung của Vòng 21 đạt **34/49**, còn **15 ca trượt**. Hồi quy Vòng 12/13/16/17 đạt **185/186**. Đóng cấp mã nguồn **8/14 nhóm**; **6/14 nhóm vẫn sửa một phần**, gồm 4 nhóm P1 và 2 nhóm P2 còn lại. P1 là lỗi có thể duyệt hoặc xác nhận sai nội dung; P2 là lỗi xác thực file hoặc nhánh chức năng có phạm vi ảnh hưởng hẹp hơn.

Kết quả 145/145 không đủ để xác nhận tuyên bố “đã sửa triệt để”. Không sửa sản phẩm trong cuộc kiểm toán này.

## 1. Mã nguồn và phạm vi

- Kiểm toán ngày **20/10/2026**, giờ Việt Nam UTC+7.
- Bản chụp lúc `2026-10-20T11:26:35.463178+00:00`, tức **18:26:35 giờ Việt Nam**.
- HEAD: `2570d96b6770957e218031c91f14ce98e766dfa7`.
- Đối tượng là **cây làm việc đang có thay đổi chưa commit**, gồm cả file mới chưa được Git theo dõi. Không coi HEAD là toàn bộ mã đang kiểm.
- SHA-256 danh mục 75 file nguồn/cấu hình/script: `b4e468d5c3af29dd2d20ef38b76d23c192186436ef69c3caf56a5c28b8da85d7`. Xem [source-state.json](source-state.json), [git-status.before.txt](git-status.before.txt), [git-status.after.txt](git-status.after.txt).
- Đã đọc quy tắc dự án, kế hoạch, báo cáo và bộ kiểm chứng R19/R20; đối chiếu luồng tải bài → parser → AI → SQLite → nháp → duyệt → worker lưu LMS → đọc lại → VERIFIED, cùng các phần bảo vệ đường dẫn, yêu cầu cục bộ và quản lý trình duyệt/hàng đợi liên quan.
- Giả định vận hành: một giáo viên dùng ứng dụng trên máy cá nhân; vẫn có thể sửa nhanh liên tiếp, nhận phản hồi mạng sai thứ tự hoặc đổi file giữa lúc xem và duyệt.

Kế hoạch `MINDX_AUTOMATION_PLAN.md` **giữ nguyên**, vì giới hạn riêng của vòng này chỉ cho ghi trong `docs/audits/round-21/`. Không thêm hoặc đánh dấu AUDIT-R21 trong kế hoạch.

## 2. Cô lập và bảo toàn

Mọi lệnh kiểm thử, TypeScript và build đều chạy ở:

```text
C:\Users\QQ\AppData\Local\Temp\mindx-round21-20261020T112635411955Z-mindx-round20-compat\snapshot
```

Hậu tố `mindx-round20-compat` giữ nguyên điều kiện kiểm tra đường dẫn của script R20, đồng thời bản sao vẫn nằm tại `%TEMP%\mindx-round21-<timestamp>\snapshot`. Không sửa script cũ để bỏ chốt này.

- Sao chép mã nguồn, hồ sơ kiểm toán và `node_modules` thành các file riêng. Không liên kết thư mục thư viện về repo gốc, không cài/cập nhật thư viện.
- Không sao chép `.env`, `.env.local`, cơ sở dữ liệu thật, `playwright-auth` hay bài nộp thật. Chỉ sao `data/config`.
- Tiến trình chỉ nhận danh sách biến Windows tối thiểu; npm chạy offline, tắt telemetry; nạp rào socket Node từ bản sao `round-19/network-guard.cjs`. Đây là rào trong Node, không phải tường lửa hệ điều hành.
- R21 dùng SQLite thật trong bộ nhớ, file giả vật lý trong TEMP, Gemini/API/DOM giả. Không mở trình duyệt, đăng nhập hay gọi LMS/Gemini thật.
- [snapshot-check.json](snapshot-check.json) xác nhận bản sao ban đầu khớp nguồn và các file bảo vệ; [isolation.json](isolation.json) ghi cách cô lập và giới hạn.
- [protected-hashes.json](protected-hashes.json) chứa danh mục trước/sau của **267/267 file bảo vệ**, gồm `next-env.d.ts` và mọi file trong `round-12`…`round-20`: **không đổi nội dung, kích thước hoặc SHA-256; không thêm/xóa file trong các thư mục đó**.
- SHA-256 `next-env.d.ts` gốc vẫn là **`B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000`**.
- [preservation-check.json](preservation-check.json) xác nhận **75/75 file nguồn/cấu hình/script và kế hoạch gốc giữ nguyên**. Trong bản sao, build chỉ làm đổi `next-env.d.ts` trong danh mục này. Không cần ghi hoặc khôi phục file gốc.

Kết quả chạy lại các vòng cũ được sao ra tên file mới dưới R21; hồ sơ lịch sử trong repo gốc không bị ghi đè.

## 3. Toàn bộ cổng kiểm tra bắt buộc

| Lệnh, chạy trong snapshot | Mã thoát | Kết quả | Bằng chứng cuối |
|---|---:|---|---|
| `node docs/audits/round-20/verify-independent.mjs` | 0 | **145/145 PASS** | [log R20](round20.attempt-2.log), [JSON R20](round20.attempt-2-results.json) |
| `node docs/audits/round-21/verify-independent.mjs` | **1** | **34/49 PASS; 15 FAIL** | [log R21](round21.attempt-3.log), [JSON R21](independent-results.json) |
| `node docs/audits/round-12/verify-independent.mjs` | **1** | **42/43 PASS; 1 FAIL** | [log R12](round12.attempt-2.log), [JSON R12](round12.attempt-2-results.json) |
| `node docs/audits/round-13/verify-independent.mjs` | 0 | 89/89 PASS | [log R13](round13.attempt-2.log) |
| `node docs/audits/round-16/verify-independent.mjs` | 0 | 16/16 PASS | [log R16](round16.attempt-2.log) |
| `node docs/audits/round-17/verify-independent.mjs` | 0 | 38/38 PASS | [log R17](round17.attempt-2.log) |
| `npx tsx scripts/test-phase4-codex-repros.ts` | 0 | Các mục của script đạt | [log phase4](phase4.attempt-2.log) |
| `npx tsx scripts/test-phase5.ts` | 0 | 7 mục của script đạt | [log phase5](phase5.attempt-2.log) |
| `npx tsc --noEmit --incremental false` | 0 | Không có lỗi kiểu dữ liệu | [log TypeScript](typecheck.attempt-2.log) |
| `npm run build` | 0 | Dựng thành công **22/22 trang** | [log build](build.attempt-2.log) |

Đã chạy đủ **10/10 lệnh khác nhau**; **8 cổng PASS, 2 cổng FAIL**. Hồi quy R12/13/16/17: **42 + 89 + 16 + 38 = 185/186**. Các thông báo lỗi mạng trong log phase4 là lỗi cố ý tạo trong ca giả; script kết thúc thành công. TypeScript và build đạt không thay thế được các kiểm tra nghiệp vụ còn trượt.

[commands.json](commands.json) lưu mã thoát trực tiếp, thư mục chạy, thời gian và hash log. Không dùng đường ống làm mất mã thoát. Lần khởi chạy đầu của 9 lệnh bị lỗi cách escape đường dẫn `NODE_OPTIONS`, trước khi mã kiểm thử chạy; đã sửa đường dẫn của bộ chạy và chạy lại đủ. Những lần này được ghi riêng là `HARNESS_STARTUP_ERROR`, không dùng JSON lịch sử làm bằng chứng mới.

R21 chạy ba lần, đều 34/49. Lần 2 sửa **bộ giả lập kiểm toán** để yêu cầu duyệt hàng loạt không bị gắn mặc định `submissionId=SUB1`; xác nhận đã đi đúng nhánh `approveAll`. Lần 3 sửa dòng chú thích kế thừa để mô tả đúng 49 ca mới, rồi chạy chính xác file cuối cùng; đây là kết quả chuẩn. Không sửa sản phẩm. Lần 1 chỉ giữ log, lần 2/3 có JSON riêng. Không chạy lại R19 riêng vì yêu cầu vòng này là chạy nguyên bộ R20 đã bao gồm 94 ca kế thừa R19.

## 4. Trạng thái đủ 14 nhóm

“CLOSED_SOURCE” chỉ xác nhận mã nguồn và tập dữ liệu giả đã kiểm, chưa xác nhận tài khoản hoặc LMS thật. Mã ca đối chiếu nằm trong [issue-status.json](issue-status.json).

| Nhóm | Trạng thái R21 | Kết quả và giới hạn |
|---|---|---|
| R19-01 | **PARTIALLY_FIXED — P2** | Chặn được 3 mẫu hỏng R20; 5 ảnh có vỏ cấu trúc đúng nhưng dữ liệu hỏng và PDF giả vẫn PARSED. |
| R19-02 | **CLOSED_SOURCE** | Giữ các kiểm tra barem/mã tiêu chí/tổng điểm; tiêu chí trùng và thiếu bằng chứng bị chặn. |
| R19-03 | **CLOSED_SOURCE** | Hash tổng hợp vẫn khóa file, tiêu chí, điểm có hiệu lực, quyết định và nhận xét; giữ tái duyệt hash cũ của R20. |
| R19-04 | **PARTIALLY_FIXED — P2 còn lại** | Đường gọi từ route đã đối chiếu file trên đĩa trước/sau AI, kể cả xóa file; nhánh nhận `parsedContent` sẵn vẫn bỏ qua đối chiếu sau AI. Chưa có caller sản phẩm hiện tại truyền nhánh đó vào grader. |
| R19-05 | **PARTIALLY_FIXED — P1** | API dùng barem gửi vào đúng; UI duyệt không gửi barem đang chọn, nên vẫn duyệt tiêu chí của barem khác. |
| R19-06 | **PARTIALLY_FIXED — P1** | Duyệt đơn có hash cũ trả 409, bản mới hợp lệ đạt. Bỏ hash hoặc duyệt hàng loạt vẫn ký file mới chưa xem. |
| R19-07 | **CLOSED_SOURCE** | Worker yêu cầu đủ ID chính xác; mã S10/SUB10, tên không có ID và modal rỗng không được ghi. |
| R19-08 | **CLOSED_SOURCE** | Có lessonId thì thiếu ánh xạ hoặc sai buổi đều chặn; cặp hợp lệ vẫn lưu/VERIFIED. |
| R19-09 | **PARTIALLY_FIXED — P1** | Hostname giả và thiếu payload đã chặn. Truy vấn có comment, chọn query trong tài liệu nhiều operation và mutation attachment vẫn được coi là lưu điểm. |
| R19-10 | **CLOSED_SOURCE** | Nhận xét trống/đọc lỗi/khác và radio quyết định sai đều không VERIFIED; GRADE/REDO đúng đều đạt. |
| R19-11 | **CLOSED_SOURCE** | Chỉnh sửa khi đọc lại không được nâng VERIFIED; giữ kiểm tra hash/trạng thái có điều kiện của R20. |
| R19-12 | **CLOSED_SOURCE** | Phản hồi buổi cũ không ghi đè buổi mới; hồi quy đổi lớp của R20 vẫn đạt. |
| R19-13 | **PARTIALLY_FIXED — P1** | Đã chặn lỗi mới + thành công cũ và chặn bulk khi còn cờ chưa lưu. Hai yêu cầu đều 200 đến server ngược thứ tự vẫn làm bản cũ được duyệt. |
| R19-14 | **CLOSED_SOURCE** | Tải lỗi dừng AI cả khi skipAi; giữ các kiểm tra tải lỗi một phần/phạm vi ID của R20. |

Tổng: **8 CLOSED_SOURCE, 6 PARTIALLY_FIXED**. R19-08 và R19-10 được đóng thêm so với R20. Sáu nhóm trước đó đã đóng không phát hiện hồi quy trong tập kiểm tra này.

## 5. Các lỗi còn lại, theo mức ảnh hưởng

### R19-09 — P1: Phản hồi thao tác khác vẫn xác nhận lưu điểm

**Nguyên nhân:** Worker dùng biểu thức tìm từ `mutation` và từ khóa trong `operationName`; chưa phân tích operation GraphQL được chọn và trường nghiệp vụ thực sự chạy. Các biến `score`, `feedback`, ID có thể xuất hiện trong request mà operation khác không dùng chúng.

**Vị trí:** [`grade-worker.ts:403`](../../../src/lib/playwright/grade-worker.ts#L403), nhất là điều kiện tại 413–427 và kết luận tại 506–513.

**Bằng chứng:** Ba ca `R21-09-operation-comment-query`, `...other-mutation`, `...selected-query` đều **verified=1** với cùng đối chứng DOM đúng. Ví dụ `# mutation\nquery SaveHomeworkGrade { studentSubmission { id } }` được nhận; mutation có tên `SaveHomeworkGrade` nhưng trường `saveSubmissionAttachment` cũng được nhận. Tài liệu bắt đầu bằng mutation khác nhưng `operationName=GradeLookup` chọn query vẫn được nhận. Đối chứng query thông thường và thiếu từng trường payload đều bị chặn đúng.

**Cách sửa:** Đối chiếu operation được chọn và đúng trường mutation lưu điểm theo hợp đồng nghiệp vụ, đồng thời ràng buộc các biến thật sự dùng cho nó. Không suy thao tác bằng từ khóa hoặc tên tùy đặt.

**Sau khi sửa:** Ba ca trên phải verified=0; đối chứng GRADE/REDO hợp lệ vẫn đạt. Đây là lỗ hổng bộ lọc được chạy bằng mã thật và request giả, chưa phải bằng chứng đã ghi nhầm trên LMS thật.

### R19-06 — P1: Duyệt hàng loạt ký phiên bản file chưa được xem

**Nguyên nhân:** Kiểm tra `fileHash` chỉ chạy nếu yêu cầu duyệt đơn có chuỗi hash. Nhánh hàng loạt không nhận/đối chiếu danh sách phiên bản giáo viên đã xem; UI chỉ gửi class, session và `approveAll`.

**Vị trí:** `approve/route.ts:57–130,231–245`; `homework-auto-grader-tab.tsx:453–475,512–532`.

**Bằng chứng:** `R21-06-version-stale` chặn duyệt đơn đúng. Nhưng `R21-06-version-omitted` trả **HTTP 200, APPROVED** cho `new-v2`; `R21-06-version-bulk` chạy handler UI thật vào **nhánh bulk thật**, cũng trả thành công và ký `new-v2` sau khi UI đã xem `reviewed-v1`. Không có thao tác sửa điểm/nhận xét giữa hai phiên bản.

**Cách sửa:** Yêu cầu phiên bản đã xem cho từng bài ở cả duyệt đơn và hàng loạt; thiếu hoặc lệch phải từ chối, không tự lấy phiên bản mới nhất làm sự chấp thuận của giáo viên.

**Sau khi sửa:** Hai ca thiếu hash/bulk đổi file không được APPROVED; tải và xem đúng bản mới rồi duyệt vẫn thành công.

### R19-13 — P1: Hai lần lưu thành công nhưng bản cũ ghi đè bản mới

**Nguyên nhân:** Số thứ tự lưu chỉ ở giao diện và chỉ điều khiển việc xóa cờ chưa lưu. API nháp không có chốt phiên bản để từ chối yêu cầu cũ đến muộn. Khi lần mới thành công trước, cờ đã bị xóa; lần cũ đến sau ghi đè dữ liệu mà không khôi phục cờ.

**Vị trí:** `homework-auto-grader-tab.tsx:409–443,512–543`; `submissions/route.ts:166–335`, nhất là ghi đè tại 329.

**Bằng chứng:** `R21-13-reordered-successes` giữ yêu cầu `FIRST OLD` trước khi gọi API thật, lưu `LATEST REVIEWED` thành công, sau đó cho yêu cầu cũ chạy. Cả hai trả 200. Trước duyệt: **UI=LATEST REVIEWED, SQLite=FIRST OLD, unsaved={}**. Bấm duyệt hàng loạt gọi API một lần, **APPROVED FIRST OLD**, tải lại UI cũng thành `FIRST OLD`. Không sửa trực tiếp DB trong phần tái hiện sau khi seed ban đầu.

**Cách sửa:** Khóa thứ tự/phiên bản tại nơi lưu nháp, hoặc tuần tự hóa các lần lưu của cùng bài; đối chiếu đúng phiên bản nội dung đã xem khi duyệt hàng loạt. Cờ trên UI đơn lẻ không bảo vệ được dữ liệu đã bị ghi đè tại server.

**Sau khi sửa:** Lần lưu cũ không thay bản mới; không duyệt hoặc làm mất `LATEST REVIEWED`. Ca thành công cũ sau lỗi mới đã đạt và phải tiếp tục đạt.

### R19-05 — P1: Barem đang chọn không đi cùng yêu cầu duyệt

**Nguyên nhân:** Khi API nhận `body.rubric`, bản sửa ưu tiên nó đúng. Nhưng handler duyệt đơn/hàng loạt của UI không gửi `activeRubric`; khi thiếu, API quay lại lấy chính danh sách điểm đang lưu làm barem. SQLite chưa lưu riêng phiên bản barem gắn với bài.

**Vị trí:** `approve/route.ts:14–34,86,214`; `submissions/route.ts:221–260`; `homework-auto-grader-tab.tsx:463–475,523–532`.

**Bằng chứng:** `R21-05-ui-authoritative-rubric` lưu nháp qua API với barem/tiêu chí `UNRELATED` được API chấp nhận. UI hiện chọn barem `C1`. Handler thật gửi duyệt **không có rubric**; server vẫn **APPROVED UNRELATED**. API có truyền barem C1 thì chặn đúng, và ca không có barem/không có điểm khóa ban đầu cũng đã chặn.

**Cách sửa:** Lưu/đối chiếu barem và phiên bản có thẩm quyền gắn với bài; nối barem đang chọn vào bước duyệt, hoặc buộc chấm lại khi đổi barem. Áp dụng cả duyệt đơn và hàng loạt.

**Sau khi sửa:** Bài có tiêu chí ngoài barem C1 không được duyệt khi UI đang chọn C1; chỉnh điểm hợp lệ vẫn hoạt động.

### R19-01 — P2: File media hỏng qua kiểm tra cấu trúc nông

**Nguyên nhân:** PNG kiểm tra tên/độ dài chunk nhưng không xác nhận dữ liệu ảnh; JPEG coi SOF/SOS độ dài tối thiểu là đủ; WebP kiểm tra vỏ RIFF và fourCC nhưng không xác nhận bitstream. PDF chỉ tìm các chuỗi con `obj`, `endobj`, `%%EOF`, không xác thực đối tượng và tài liệu.

**Vị trí:** `media-reader.ts:63–82,98–134,145–161`.

**Bằng chứng:** Sáu ca trượt: `R21-01-png-invalid-idat`, `...jpeg-empty-sof`, `...webp-VP8`, `...webp-VP8L`, `...webp-VP8X`, `...pdf-token-spoof`. Cả năm mẫu ảnh được **bộ giải mã sharp thật từ chối trước**, nhưng parser trả **PARSED + 1 inlineData**. PDF giả 57 byte không có khai báo đối tượng dạng `n n obj`, các từ khóa đảo thứ tự vẫn PARSED. Không dùng bộ giải mã PDF độc lập; mẫu PDF được chứng minh sai cấu trúc trực tiếp. Bốn mẫu media hợp lệ đều đạt đối chứng.

**Cách sửa:** Xác thực khả năng giải mã/cấu trúc thật trong giới hạn tài nguyên phù hợp; lỗi phải PARSE_ERROR và không phát inlineData. Chỉ thêm tên chunk/marker không đủ.

**Sau khi sửa:** Cả sáu mẫu lỗi bị chặn; PNG/JPEG/WebP/PDF hợp lệ vẫn giữ nguyên bytes.

### R19-04 — P2 còn lại: Nhánh parsedContent bỏ kiểm tra file đổi

**Nguyên nhân:** `parsedFromDisk` chỉ thành true khi grader tự đọc file. Khi caller truyền `parsedContent` có sẵn dù vẫn có đường dẫn file vật lý, bước đọc lại sau AI bị bỏ qua.

**Vị trí:** `homework-grader.ts:231–233,278–279,550–565,595`.

**Bằng chứng:** `R21-04-disk-supplied-during` parse file thật `print(1)`, truyền kết quả cùng đường dẫn, đổi file thành `print(2)` trong lời gọi AI giả. Kết quả **staleIgnored=false**, DB giữ hash `d287…efe99` và lưu đề xuất, trong khi file trên đĩa là `fc92…ae7c`. Các ca grader tự đọc file — không đổi, đổi trước AI, đổi trong AI và xóa khi AI chạy — đều đạt.

**Phạm vi:** `download-and-grade/route.ts` hiện chỉ truyền đường dẫn vào grader, không truyền `parsedContent`. Nhánh còn lỗi là giao diện hàm nội bộ có hỗ trợ; chưa chứng minh người dùng đi qua route hiện tại có thể kích hoạt nó. Vì vậy hạ mức phần còn lại xuống **P2**, không báo như lỗi P1 trên luồng route đã sửa.

**Cách sửa:** Nếu có đường dẫn, luôn đối chiếu bytes/hash trên đĩa sau AI dù dữ liệu parse được cung cấp sẵn; hoặc bỏ nhánh này nếu không còn dùng và điều chỉnh caller/test hợp lệ.

**Sau khi sửa:** Ca supplied-during phải bỏ kết quả cũ và giữ nguyên bản DB trước AI.

## 6. Một cổng hồi quy không đạt: hợp đồng chuỗi URL ngắn

**Nguyên nhân:** R12 gọi `waitForApiResponse('lms-api', ...)`, trước đây là tìm chuỗi trong URL. Bản sửa coi mọi chuỗi không có `/` hoặc `:` là hostname đầy đủ; `lms-api.mindx.edu.vn` không khớp hostname `lms-api`.

**Vị trí:** `network-interceptor.ts:76–86`; ca gốc R12 tại `verify-independent.mjs:144–151`.

**Bằng chứng:** Ca `R2-02/A09: actual network filter rejects unrelated requests and GraphQL errors` của R12 trượt vì phản hồi đúng cũng bị loại. `R21-09-phase4-host-token` bổ sung xác nhận **matched=false** với URL thật về mặt cấu trúc `https://lms-api.mindx.edu.vn/`. R21 dùng phản hồi giả, không phát request ra ngoài.

**Giới hạn kết luận:** Caller sản phẩm `save-comments.ts:531–536` hiện dùng RegExp `/lms-api\.mindx\.edu\.vn/i`, không dùng chuỗi ngắn `'lms-api'`; worker Phase 5 dùng `'mindx.edu.vn'`. **Chưa có bằng chứng luồng nhận xét thật bị hỏng.** Đây là lỗi tương thích hợp đồng bộ lọc/kiểm thử cũ, mức **P2**, không phải nhóm R19 mới và không cộng thành nhóm thứ 15. Tuy vậy tiêu chí của vòng này yêu cầu mọi cổng PASS, nên R12 FAIL vẫn chặn GO.

**Cách xử lý:** Quyết định rõ hợp đồng tham số lọc và nối các caller/test theo hợp đồng an toàn đó ở một thay đổi được phép riêng. Không khôi phục việc tìm chuỗi tùy ý khiến URL giả vượt rào; không sửa hồ sơ R12–R20 trong vòng kiểm toán này.

## 7. Độ tin cậy và phần chưa kiểm tra

[verify-independent.mjs](verify-independent.mjs) là bộ tự chứa, có chốt chỉ chạy ở snapshot R21 trước khi tạo fixture. Phần harness kế thừa minh bạch từ R20; các ca/điều kiện mới ở R21. Bộ thử đọc file nguồn của snapshot, bỏ import/type để chạy nguyên thân hàm với phụ thuộc giả được chỉ rõ; không vá thân hàm sản phẩm để làm test đạt. SQLite và file fixture là thật; các ảnh hợp lệ được mã hóa và ảnh hỏng được giải mã đối chứng bằng sharp đã có sẵn.

Các mã ca đều duy nhất, kết quả liên kết hash nguồn thực tế. 49 ca mới và 145 ca R20 có phần kiểm tra cùng hành vi; không cộng chúng thành số trường hợp nghiệp vụ độc nhất. 15 ca FAIL gồm **14 ca phần sửa chưa đủ của sáu nhóm R19** và **1 ca tương thích hợp đồng R12**.

Chưa kiểm tra LMS/Teaching thật, Gemini thật, tài khoản thật, trình duyệt Chromium thật, vị trí ID/modal thật, thời điểm đóng/mở modal thật hoặc lịch chạy khi tắt máy. Hook/DOM giả xác nhận đường đi xử lý, không chứng minh giao diện React trong trình duyệt hoặc sản phẩm đã được Owner chấp nhận. Không đưa ra kết luận hiệu năng hoặc mức tải nhiều người dùng ngoài phạm vi một máy cá nhân.

## 8. Việc tiếp theo

Ưu tiên sửa R19-09, R19-06, R19-13, R19-05; sau đó phần media và nhánh parsedContent. Xử lý rõ sự khác biệt hợp đồng của cổng R12. Chạy lại toàn bộ trong snapshot mới và chỉ ký GO khi **14/14 nhóm CLOSED_SOURCE cùng 10/10 cổng PASS**, với hash nguồn mới được đối chiếu.

Gợi ý giao việc cho vòng sửa riêng:

> Sửa đúng sáu nhóm còn mở và lỗi tương thích cổng R12 theo REPORT.vi.md của round-21. Khóa đúng operation GraphQL lưu điểm; yêu cầu phiên bản đã xem cho duyệt đơn/bulk; bảo vệ thứ tự ghi nháp tại server; gắn barem có thẩm quyền vào duyệt; từ chối media không giải mã/cấu trúc hợp lệ; kiểm tra file drift cả khi có parsedContent. Giữ nguyên hồ sơ kiểm toán lịch sử, không làm yếu ca âm để đổi FAIL thành PASS. Kiểm tra lại đủ 10 cổng trong snapshot riêng và báo rõ giới hạn chưa thử trên LMS thật.

**Đã làm:** Kiểm toán chỉ đọc, bộ R21, đủ các lệnh bắt buộc và bằng chứng bảo toàn.

**Kết quả:** **NO-GO**; 8 nhóm đóng, 6 nhóm còn mở; 8/10 cổng đạt.

**Chưa kiểm tra:** Dịch vụ/tài khoản/trình duyệt thật và nghiệm thu sử dụng thực tế.

**Việc tiếp theo:** Giao vòng sửa riêng theo các ca trượt; chưa dùng kết quả này để cho phép tự động ghi điểm thật.
