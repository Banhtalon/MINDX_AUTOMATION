# Kiểm toán độc lập Vòng 17 — xác minh sâu Giai đoạn 1–4

**Kết luận: NO-GO ở cấp mã nguồn để chuyển sang Giai đoạn 5.**

Ứng dụng hỗ trợ giáo viên đồng bộ lớp, soạn và duyệt nhận xét, lưu lên LMS, thu thập bảng điểm và xuất báo cáo. Kiểm toán giả định một giáo viên dùng máy cá nhân, có thể mở nhiều tab; các tác vụ điều khiển LMS phải chạy tuần tự.

**Cả 6 lệnh bắt buộc đã chạy thật và đều thoát 0.** Bản dựng hoàn tất **18/18 trang**. Ba bộ độc lập cũ đạt **43/43 + 89/89 + 16/16 = 148/148 nhóm**. Đủ **49 mã Vòng 1–12, 7 ca gốc Vòng 15 và 5 ca gốc Vòng 16** đạt điều kiện cũ.

Tuy nhiên, **38 ca mở rộng Vòng 17 có 32 đạt, 6 trượt, thuộc 4 nhóm lỗi: 1 P1 và 3 P2**. Hai lỗi giao diện được xác nhận thêm bằng Chromium, HTTP và ứng dụng dựng sẵn thật, chỉ dùng dữ liệu giả. Vì vậy chưa thể công nhận tuyên bố “khắc phục triệt để” hoặc đóng toàn diện R16-02/R16-03/R16-04.

## 1. Nguồn và cách thực hiện

- Ngày kiểm toán: **20/10/2026**. Chụp nguồn lúc **2026-10-20T05:25:06.899Z**, tức **12:25:06 giờ Việt Nam**.
- HEAD tham chiếu: `2570d96b6770957e218031c91f14ce98e766dfa7`. Dự án đã có nhiều thay đổi chưa commit trước phiên kiểm toán; xem [trạng thái ban đầu](git-status.before.txt). Kết luận áp dụng cho **nội dung cây làm việc được chụp**, không tự áp dụng cho riêng HEAD hay bản sửa sau này.
- [source-state.json](source-state.json) ghi SHA-256, tức dấu vân tay nội dung, của **58 tệp**. Dấu vân tay bản đồ nguồn: `6950c95d48be771fb1c89e134fa4ae1be13708e30774fa9e26b90837323d8d39`.
- So với dấu vân tay Vòng 16, phần thay đổi là **4 tệp sản phẩm**, `scripts/test-phase4-codex-repros.ts` và kế hoạch. Các tệp nguồn nền tảng còn lại trong bản đồ khớp Vòng 16. Xem [phạm vi rà soát](review-scope.json).
- Đã đọc và đối chiếu kế hoạch, bốn tệp sản phẩm, bộ hồi quy, đường gọi từ giao diện/API, cách lưu phiên bản và mã băm trong SQLite, hàng đợi, bộ quản lý trình duyệt và các lớp bảo vệ cục bộ.
- Các lệnh chạy trên bản sao `C:\Users\QQ\AppData\Local\Temp\mindx-round17-N31WWp`. Mã nguồn, cấu hình công khai, script lịch sử và kiểm thử được sao chép và đối chiếu byte trước khi chạy; thư viện cài sẵn được sao chép đầy đủ. [snapshot-check.json](snapshot-check.json) không có tệp lệch.
- Không sao chép `.env`, `.env.local`, dữ liệu học viên thật, cơ sở dữ liệu thật hoặc hồ sơ đăng nhập thật. Không đăng nhập Teaching/LMS hoặc gọi Gemini thật. Kiểm thử AI dùng phản hồi giả; kiểm thử dữ liệu dùng SQLite thật trong bộ nhớ. Kiểm thử giao diện dùng một hồ sơ trình duyệt riêng trong bản sao.
- Các script cũ có lệnh ghi lại kết quả vào thư mục lịch sử, còn build có thể viết lại `next-env.d.ts`. Những việc đó chỉ xảy ra trong bản sao. Dự án gốc **không sửa rồi khôi phục** các tệp được bảo vệ.
- [preservation-check.json](preservation-check.json) và [final-state.json](final-state.json) xác nhận **111/111 tệp** thuộc `next-env.d.ts` và toàn bộ Vòng 12/13/14/15/16 giữ nguyên từng byte và danh sách tệp. Không sửa mã sản phẩm; kế hoạch chỉ thêm ghi chú AUDIT-R17.

## 2. Lệnh bắt buộc và kết quả mới

[commands.json](commands.json) ghi chính xác lệnh, thư mục chạy, thời điểm bắt đầu/kết thúc, mã thoát của tiến trình và SHA-256 log. Không suy ra thành công từ lệnh qua đường ống hoặc chỉ từ câu “PASS” trong log.

| Lệnh đã thực thi | Kết quả | Bằng chứng |
|---|---|---|
| `npx tsx scripts/test-phase4-codex-repros.ts` | Thoát 0; các điều kiện hồi quy đã có, gồm R16-01…05, đạt | [regressions.log](regressions.log) |
| `node docs/audits/round-12/verify-independent.mjs` | Thoát 0; **43 đạt, 0 trượt** | [log](round12-independent.log), [JSON](round12-independent-results.json) |
| `node docs/audits/round-13/verify-independent.mjs` | Thoát 0; **89 đạt, 0 trượt** | [log](round13-independent.log), [JSON](round13-independent-results.json) |
| `node docs/audits/round-16/verify-independent.mjs` | Thoát 0; **16 đạt, 0 trượt**: 7 ca R15, 5 ca R16, 4 ca nền tảng | [log](round16-independent.log), [JSON](round16-independent-results.json) |
| `npx tsc --noEmit --incremental false` | Thoát 0; không báo lỗi kiểu dữ liệu | [typecheck.log](typecheck.log), [biên nhận](commands.json) |
| `npm run build` | Thoát 0; biên dịch, TypeScript và tạo **18/18 trang** hoàn tất | [build.log](build.log) |

Log TypeScript rỗng là hợp lệ và có mã thoát 0. Một số dòng lỗi mạng trong log hồi quy do các ca cố ý mô phỏng thất bại; không phải lệnh bị trượt. Dòng tổng kết hồi quy vẫn ghi “ROUND 1 -> ROUND 15”, nhưng phần R16 thực sự có mặt và được chạy; không dùng dòng chữ tổng kết để tính độ bao phủ.

Các kiểm tra độc lập bổ sung:

| Kiểm tra | Kết quả | Bằng chứng |
|---|---|---|
| `node docs/audits/round-17/verify-independent.mjs` | **Thoát 1 đúng vì phát hiện lỗi**; 32 đạt, 6 trượt trong 38 ca cuối | [mã kiểm tra](verify-independent.mjs), [log cuối](verify-independent-final.log), [JSON cuối](independent-results.json) |
| `node docs/audits/round-17/smoke-local.mjs` | Thoát 0: tái hiện thành công 2 lỗi UI và xác nhận xung đột ghi chú đã sửa | [mã kiểm tra](smoke-local.mjs), [log](smoke-local.log), [JSON](smoke-results.json) |
| Kiểm tra nguồn và nội dung gửi trình duyệt | 14 tệp JavaScript không chứa 4 tên biến mật khẩu/khóa đã kiểm; các manifest thư viện trong bản sao khớp bản gốc | [review-scope.json](review-scope.json) |

Lần chạy mở rộng sơ bộ được giữ trong `verify-independent.log` và `independent.initial-results.json`. Sau khi đọc điều kiện hiển thị, kiểm toán thu hẹp ca UI: **không dùng việc gọi trực tiếp hàm sửa một ô đang bị ẩn để kết luận giáo viên có thể làm mất dữ liệu bằng giao diện**. Kết luận cuối dùng ca đã điều chỉnh và thao tác **Copy thật** trong Chromium. Mã sản phẩm không thay đổi giữa các lần chạy.

## 3. Bốn lỗi cần sửa

P1 là ưu tiên cao vì ảnh hưởng nội dung đã duyệt. P2 là lỗi chức năng hoặc tính đầy đủ của dữ liệu/báo cáo cần sửa trước khi qua cổng Giai đoạn 5. Các phát hiện này không phải kết luận về tấn công từ Internet.

### R17-01 — P1: Nhánh AI có dữ kiện vẫn thay mất bản đã duyệt hoặc đã xác minh

**Nguyên nhân:** Kiểm tra `expectedRowVer >= 0` đã được đặt đúng trước các nhánh. Tuy nhiên, lớp bảo vệ trạng thái `APPROVED`/`VERIFIED` chỉ nằm **bên trong nhánh thiếu dữ kiện**. Khi có thẻ đánh giá hoặc ghi chú, bản đã duyệt vẫn được đưa vào danh sách gọi AI. Nếu dữ liệu không thay đổi trong thời gian đợi AI, lớp kiểm tra sau gọi không chặn lần ghi này.

**Vị trí:** `src/lib/gemini/comment-generator.ts:195`–214, `:259`, `:478`–533 và `:558`–577. `src/app/session-comments/page.tsx:982` lọc active/có mặt nhưng không loại các bản đã duyệt khỏi nút soạn hàng loạt; API `generate-ai` cũng chuyển chúng vào bộ sinh nhận xét.

**Tái hiện:** Một học viên active/có mặt, `finalText = APPROVED TEACHER TEXT`, mã băm đúng, trạng thái `APPROVED` hoặc `VERIFIED`; gửi yêu cầu đúng phiên bản hiện tại, có một Quick Tag. Kết quả: AI được gọi 1 lần, `finalText` thành `AI RESULT`, trạng thái thành `DRAFT`, mã băm thành rỗng. Cùng dữ liệu nhưng không có thẻ/ghi chú thì được giữ nguyên.

**Bằng chứng:** Hai ca `R17-01-APPROVED-true` và `R17-01-VERIFIED-true` trượt tại [kết quả độc lập](independent-results.json). SQLite thật trong bộ nhớ; AI giả để không gửi dữ liệu ra ngoài. Đây là phần yêu cầu R16-03 “kiểm tra trạng thái ngay từ đầu trước mọi nhánh ghi” chưa được triển khai đủ. Ca yêu cầu cũ sai phiên bản của Vòng 16 đã đạt, nhưng không bao phủ trường hợp này.

**Cách sửa tối thiểu:** Đưa bảo vệ trạng thái lên trước cả hai nhánh. Giữ nguyên toàn bộ chữ, các phần nhận xét, hash và thời điểm VERIFIED; trả kết quả bị bỏ qua. Nếu sau này cần tái soạn bản đã duyệt, phải có hành vi sản phẩm riêng làm rõ việc mở lại bản nháp; không gộp ngầm vào nút soạn cả lớp.

**Sau khi sửa:** Cả hai ca phải không gọi AI và không đổi bản ghi. Bản DRAFT hợp lệ vẫn nhận kết quả AI. Các ca đang chờ AI mà bị sửa vẫn phải giữ phiên bản mới nhất.

### R17-02 — P2: Thiếu thông tin giữ dữ liệu nhưng nút Copy lấy câu thông báo thay nhận xét

**Nguyên nhân:** Nhánh thiếu dữ kiện tính `preservedFinalText` và giữ các phần cũ khi ghi SQLite, nhưng phản hồi vẫn dùng `insufficientResult`: ba phần rỗng, nội dung là câu “Chưa đủ thông tin…”. Giao diện lấy phản hồi đó thay dữ liệu hiện có. Nút Copy đọc `student.finalText` trong màn hình nên sao chép câu thông báo.

**Vị trí:** `src/lib/gemini/comment-generator.ts:217`–253, nhất là `:253`; `src/app/session-comments/page.tsx:1081`–1088, điều kiện ẩn ô sửa ở `:1637` và nút Copy ở `:1748`.

**Tái hiện:** Có một bản nháp giáo viên đã nhập nhưng không có thẻ/ghi chú riêng. Bấm “AI Soạn Nhận Xét Hàng Loạt”. SQLite vẫn chứa `TEACHER DRAFT TO PRESERVE`; phản hồi và clipboard lại chứa “Chưa đủ thông tin để nhận xét…”. Các ô nhận xét cũ bị ẩn bởi trạng thái INSUFFICIENT_INFO.

**Bằng chứng:** `R17-02-insufficient-response` và `R17-02-ui` trong [kết quả độc lập](independent-results.json). Luồng thật `smoke-results.json → observations.insufficientCopy` xác nhận HTTP 200, nội dung dữ liệu, nội dung đã copy và ô sửa bị ẩn; [ảnh](insufficient-copy.png). Không gọi Gemini thật.

**Giới hạn phát hiện:** Trong ca này **SQLite chưa bị mất nhận xét cũ**. Không dùng hàm sửa trực tiếp một trường đang bị ẩn làm bằng chứng mất dữ liệu qua giao diện. Lỗi đã xác nhận là hiển thị/khả năng tiếp tục sửa và sao chép sai nội dung.

**Cách sửa tối thiểu:** Khi đã có nội dung, trả và giữ đúng nội dung cùng ba phần đang lưu. Thông báo thiếu dữ kiện phải là thông báo riêng, không làm `formattedFullComment` và không che mất bản nháp đang có. Bản chưa có nhận xét vẫn báo thiếu thông tin và không gọi AI.

**Sau khi sửa:** Nhận xét trong dữ liệu, màn hình và clipboard phải khớp; ba phần cũ vẫn đọc/sửa được. Giữ kiểm tra không gọi AI khi không đủ dữ kiện.

### R17-03 — P2: Nhánh GraphQL vẫn ghi đè cache đầy đủ bằng bảng thiếu học viên inactive

**Nguyên nhân:** Nhánh DOM mới dùng toàn bộ danh sách lớp làm mức tối thiểu, nhưng nhánh phản hồi mạng GraphQL chỉ đếm học viên active. Khi phản hồi không có nhãn tổng và bỏ sót học viên inactive, nó vẫn vượt kiểm tra rồi thay bản lưu bảng điểm.

**Vị trí:** `src/lib/playwright/scrape-scores.ts:293`–299; đối chiếu nhánh DOM ở `:515` và `:858`; ghi cache tại `:571`.

**Tái hiện:** Danh sách lớp có S1 active và S2 inactive; SQLite đang lưu bảng đủ 2 học viên. Phản hồi đúng lớp từ `FindStudentSubmissionByClass`, HTTP 200, chỉ có S1, không có trường tổng. Toàn bộ `scrapeClassScores` trả `success: true`, gọi lưu 1 lần, và bảng lưu từ **2 dòng thành 1 dòng**. Phản hồi đầy đủ cả hai học viên vẫn hoạt động bình thường.

**Bằng chứng:** `R17-03-partial-network` trượt, ca đối chứng `R17-03-complete-control` đạt trong [kết quả độc lập](independent-results.json). Đã kiểm tra dữ liệu cache thực tế bằng SQLite trong bộ nhớ, không chỉ đếm một hàm lưu giả. Đây là phần quy tắc bảo toàn cache/roster của R16-02 còn hở ở đường dữ liệu được ưu tiên trước DOM.

**Cách sửa tối thiểu:** Đối chiếu danh sách đã ánh xạ với toàn bộ roster cần báo cáo, gồm inactive, trước khi ghi cache ở cả hai nhánh. Nếu thiếu hoặc chưa xác minh được đủ, trả thất bại và giữ bản lưu cũ. Tối thiểu không được dùng riêng `expectedActiveCount` cho điều kiện này.

**Sau khi sửa:** Phản hồi thiếu S2 phải thất bại, số lần ghi bằng 0 và bản cache cũ khớp nguyên nội dung. Phản hồi đủ, kể cả điểm 0 và trạng thái chưa nộp, vẫn phải xuất được.

### R17-04 — P2: Xung đột Quick Tags hiển thị nhầm bản đã lưu

**Nguyên nhân:** Đã xử lý `staleIgnored` bằng `false`, giữ bản nhập và đọc lại đúng lớp/buổi/học viên. Tuy nhiên, khi chọn giá trị để so sánh, giao diện chỉ phân biệt ghi chú, nội dung tổng và trường hợp còn lại là điểm danh. Thay đổi Quick Tags rơi vào trường hợp còn lại.

**Vị trí:** `src/app/session-comments/page.tsx:811`–820.

**Tái hiện:** Hai tab mở cùng một học viên. Tab A lưu thẻ “Hăng hái phát biểu”; tab B chọn “Tập trung cao độ” từ phiên bản cũ. Cơ sở dữ liệu giữ đúng thẻ của tab A, tab B giữ đúng lựa chọn chưa lưu, nhưng cảnh báo ghi **“Bản đã lưu: PRESENT”**. Giáo viên không được xem các thẻ thật để so sánh như yêu cầu R16-04.

**Bằng chứng:** `R17-04-tags-conflict` trượt trong [kết quả độc lập](independent-results.json); Chromium thật xác nhận `smoke-results.json → observations.tagConflictWrongValue`; [ảnh](tag-conflict.png). Ca ghi chú đã sửa đúng: trả false, giữ bản nhập và hiển thị “FIRST TAB SAVED”.

**Cách sửa tối thiểu:** Chọn và định dạng giá trị so sánh theo đúng trường đã sửa; với Quick Tags, đọc `quickTagsJson`, hiển thị các nhãn đã lưu hoặc danh sách rỗng rõ ràng. Tiếp tục giữ bản chưa lưu, cảnh báo lỗi và trả false.

**Sau khi sửa:** Xung đột từng loại dữ liệu phải hiển thị đúng giá trị đã lưu của học viên, lớp và buổi đó. Không tự ghi lại bản bị từ chối để đè tab khác.

## 4. Các bản sửa đã xác minh hoạt động

- **R16-01:** Chậm 650 ms thu đủ hai trang. Kiểm tra mở rộng toàn worker với 0/100/650 ms, có và không có màn hình 0 dòng tạm thời, đều có đủ học viên active và inactive.
- **R16-02 ở DOM:** Trang tiếp theo trống, trang kẹt hoặc thiếu nút Next nhưng roster còn thiếu đều thất bại và giữ nguyên cache SQLite. Giới hạn 50 trang, dòng trùng và định danh không khớp vẫn được kiểm tra trong bộ cũ. Hở nhánh GraphQL được ghi riêng R17-03.
- **R16-03 ở yêu cầu cũ:** Phiên bản kỳ vọng 0 không vượt được lớp kiểm tra. Sáu tổ hợp DRAFT/APPROVED/VERIFIED × có/không dữ kiện đều giữ nguyên toàn bộ bản ghi và không gọi AI khi phiên bản cũ.
- **R16-04 với ghi chú:** Ca độc lập xác nhận `false`, không thay bản nhập bằng bản máy chủ, thông báo lỗi chứa chữ đã lưu và GET đúng lớp/buổi; có kiểm tra `studentId` khi lấy bản ghi. Chromium xác nhận hành vi đó.
- **R16-05:** Hai ca đối chứng PRESENT/LATE lưu thành công. Mười ca đổi điểm danh ABSENT/UNKNOWN, inactive, nội dung hoặc ghi chú trong lúc điền và sau khi đóng toast đều có **0 lần bấm Save**, **0 VERIFIED**, giữ **DRAFT**. Ca đổi điểm danh sau khi Save đã gửi vẫn chặn VERIFIED. Không mô tả lớp kiểm tra sau gửi là có thể rút lại yêu cầu đã gửi.
- **Nền tảng:** Bộ Vòng 16 còn xác minh 7 bảng, khóa học viên theo lớp, chủ bài nộp bất biến, nâng bảng thêm metadata không mất nhận xét cũ; một context dùng chung và hàng đợi tối đa một tác vụ chạy. Luồng SSE gỡ đăng ký trong 40 tổ hợp đóng/hủy.

## 5. Đánh giá chất lượng bộ hồi quy

Đã bổ sung đủ năm nhãn R16 trong `scripts/test-phase4-codex-repros.ts`; lệnh thật chạy thành công. Các ca dùng mã sản phẩm hiện tại, có SQLite thật trong bộ nhớ và không cần tài khoản thật. Điều này xác nhận **các kịch bản đã viết**, không chứng minh mọi biến thể của lỗi đều hết.

| Phần kiểm thử | Đã bảo vệ | Khoảng trống xác nhận trong Vòng 17 |
|---|---|---|
| R16-01, dòng 3670–3826 | Chuyển hai trang chậm 650 ms | Không thay thế kiểm tra đủ roster ở nhánh GraphQL. |
| R16-02, dòng 3760–3833 | Toàn worker, 0 dòng tạm thời, gồm inactive | Bộ dự án dùng hàm lưu cache giả; chưa tự chứng minh giữ nội dung cache SQLite cũ khi thiếu dữ liệu. Ca Vòng 17 đã kiểm tra thêm. |
| R16-03, dòng 3835–3954 | Yêu cầu thiếu dữ kiện cũ không thay bản APPROVED | Chưa thử bản duyệt đúng phiên bản đi vào nhánh có dữ kiện, hoặc phản hồi thiếu dữ kiện khi đã có bản nháp. |
| R16-04, dòng 3957–4033 | Hai tab, bản ghi chú mới bị từ chối có cảnh báo lỗi | Chưa kiểm giá trị trả false, bản nhập được giữ, nội dung đọc lại hoặc xung đột Quick Tags. |
| R16-05, dòng 4036–4153 | Chuyển ABSENT lúc điền phải chặn click | Chưa bao phủ các điều kiện khác, thời điểm sau đóng toast và sau click; 13 ca Vòng 17 bổ sung đã đạt. |

Bộ kiểm tra hàm giao diện trong VM dùng bộ mô phỏng trạng thái, không phải React/Chromium thật. Bởi vậy hai vấn đề liên quan nội dung trên màn hình đã được xác nhận thêm bằng bản dựng thật. Các phần mô phỏng Playwright/GraphQL không được gọi là nghiệm thu LMS thật.

## 6. Đối chiếu đủ 61 mã

**T** = bộ hồi quy dự án chạy mới tại Vòng 17. **I12:n** = nhóm tại dòng n của bộ độc lập Vòng 12, nhưng kết quả được chạy mới và lưu trong thư mục Vòng 17. **I13** = 89 nhóm Vòng 13 chạy mới. **I16:mã** = ca trong Vòng 16 chạy mới. **I17:mã** = ca mở rộng cuối Vòng 17. **SM** = ứng dụng dựng sẵn + HTTP + Chromium với dữ liệu giả.

49 mã lịch sử và 12 mã R15/R16 đều đạt **ca gốc đã lưu**. Các hàng “còn mở rộng/chưa đóng” nêu rõ phần yêu cầu rộng hơn chưa đạt. Không cộng số mã lỗi với số nhóm kiểm thử, và không diễn giải thành “61/61 đã đóng toàn diện”. Danh sách có cấu trúc tại [issue-status.json](issue-status.json).

| Mã | Nội dung đối chiếu | Kết quả Vòng 17 | Bằng chứng mới |
|---|---|---|---|
| #1 | Đọc lại đầy đủ nhận xét, từ chối nội dung thừa | Đạt ca lịch sử | T; I12:117 |
| #2 | Phản hồi nghiệp vụ thành công và nội dung đọc lại phải đúng | Đạt ca lịch sử | T; I12:117,144 |
| #3 | Khóa đúng lớp, buổi, học viên | Đạt ca lịch sử | T; I12:117,158 |
| #4 | Đọc nhiều trang; không phá dữ liệu khi đồng bộ rỗng | Đạt ca lịch sử | T; I12:179 |
| #5 | Sửa trong lúc lưu LMS không biến nháp mới thành VERIFIED | Đạt ca lịch sử | T; I12:117 |
| #6 | Điền nội dung như văn bản, không thực thi thẻ HTML | Đạt ca lịch sử | T; I12:125 |
| #7 | Trùng tên vẫn tách mã; dữ liệu điểm sai không ghi đè bản lưu | Đạt ca lịch sử | T; I12:158,190 |
| #8 | Phân biệt điểm 0, chưa chấm, chưa nộp, làm lại | Đạt ca lịch sử | T; I12:166 |
| #9 | Chặn công thức bảng tính và ký tự làm lệch hàng/cột | Đạt ca lịch sử | T; I12:224 |
| #10 | Đổi lớp/đọc lại không xuất bảng điểm cũ | Đạt ca lịch sử | T; I12:240 |
| #11 | Tách Quiz và thực hành, giữ điểm 0 và trạng thái xuất | Đạt ca lịch sử | T; I12:158,166,224 |
| #12 | Không bịa 14 buổi; Zalo theo khóa, không gán lịch cứng | Đạt ca lịch sử | T; I12:179,231 |
| #13 | AI lọc học viên đủ điều kiện; thiếu dữ kiện không tự viết | Đạt ca lịch sử | T; I12:212 |
| #14 | Đọc cấu hình qua giới hạn đường dẫn cho phép | Đạt ca lịch sử | T; I12:231 |
| R2-01 | A01 — So toàn bộ nội dung đã duyệt | Đạt ca lịch sử | T; I12:117 |
| R2-02 | A09 — Lọc đúng thao tác và định danh yêu cầu mạng | Đạt ca lịch sử | T; I12:133,144 |
| R2-03 | A02 — Tên ngắn không khớp một phần tên dài | Đạt ca lịch sử | T; I12:152 |
| R2-04 | A11 — Mã học viên ổn định khi đổi thứ tự danh sách | Đạt ca lịch sử | T; I12:179 |
| R2-05 | A03/A05 — Chặn lớp chưa xác thực, danh sách sai, trùng tên mơ hồ | Đạt ca lịch sử | T; I12:158 |
| R2-06 | A04/A06 — Thiếu bài nộp hoặc ma trận không hợp lệ bị chặn | Đạt ca lịch sử | T; I12:158,190 |
| R2-07 | A12 — Phát hiện trang trùng/kẹt/vượt giới hạn | Đạt ca lịch sử | T; I12:172 |
| R2-08 | A10 — Đổi lớp/đọc điểm không treo trạng thái chờ | Đạt ca lịch sử | T; I12:240 |
| R2-09 | A07/A08 — API nháp/duyệt/AI kiểm tra thành viên và điểm danh | Đạt ca lịch sử | T; I12:202,212 |
| R2-10 | A12/A14 — Quiz riêng, MARKED thiếu điểm bị chặn | Đạt ca lịch sử | T; I12:158,166 |
| R2-11 | A13 — AI thiếu nội dung trả FAILED, không tạo nhận xét thay thế | Đạt ca lịch sử | T; I12:212,255 |
| R3-01 | Nội dung thừa cùng dòng/xuống dòng/tab không được VERIFIED | Đạt ca lịch sử | T; I12:117 |
| R3-02 | Yêu cầu mạng rỗng hoặc sai buổi bị chặn | Đạt ca lịch sử | T; I12:133 |
| R3-03 | Sai danh sách dù cùng số lượng hoặc trùng tên thiếu mã bị chặn | Đạt ca lịch sử | T; I12:158 |
| R3-04 | Trạng thái, điểm, mã cột không hợp lệ bị chặn | Đạt ca lịch sử | T; I12:190 |
| R3-05 | Tra học viên bắt buộc theo lớp, AI thiếu định danh không chạy | Đạt ca lịch sử | T; I12:190,212 |
| R3-06 | AI lỗi/lưu ghi chú riêng không xóa nhận xét đang có | Đạt ca lịch sử | T; I12:202,255 |
| R3-07 | Ẩn tên trong ghi chú và thẻ trước khi gọi AI | Đạt ca lịch sử | T; I12:212 |
| R4-01 | Danh sách lớp cũ đến muộn không thay lớp mới | Đạt ca lịch sử | T; I12:243 |
| R4-02 | Định danh mâu thuẫn hoặc yêu cầu chỉ có nhận xét bị chặn | Đạt ca lịch sử | T; I12:133 |
| R4-03 | Đọc điểm lỗi khi tải bản lưu phải tắt cả hai trạng thái chờ | Đạt ca lịch sử | T; I12:240 |
| R4-04 | Thiếu columnId/maxScore/score bị từ chối | Đạt ca lịch sử | T; I12:190 |
| R4-05 | Gọi trực tiếp AI với buổi khác lớp cũng bị chặn | Đạt ca lịch sử | T; I12:212 |
| R4-06 | Hết 50 trang vẫn còn trang tiếp phải báo chưa đọc đủ | Đạt ca lịch sử | T; I12:172 |
| R5-01 | Đổi buổi cùng lớp bỏ hàng cũ, chặn lưu/duyệt nhầm buổi | Đạt ca lịch sử | T; I12:243 |
| R5-02 | Duyệt bản cũ không làm sai trạng thái/nội dung bản vừa sửa | Đạt ca lịch sử | T; I12:252 |
| R5-03 | Trường định danh/nội dung null bị chặn ở mọi tầng yêu cầu | Đạt ca lịch sử | T; I12:133 |
| R5-04 | Đổi lớp rồi đọc điểm lỗi ngay không tạo GET thừa gây treo | Đạt ca lịch sử | T; I12:240 |
| R6-01 | API nháp/duyệt chỉ chấp nhận học viên đúng lớp, đang học; duyệt PRESENT/LATE | Đạt ca lịch sử | T; I12:202 |
| R7-01 | Sửa ghi chú/thẻ/điểm danh lưu DRAFT qua đọc lại | Đạt ca lịch sử | T; I12:264,; I13 |
| R8-01 | Điểm danh cả lớp có lỗi không báo tất cả thành công | Đạt ca lịch sử | T; I12:261 |
| R9-01 | Phản hồi lưu lỗi cũ không khôi phục đè dòng mới/lớp mới | Đạt ca lịch sử | T; I12:258,267 |
| R10-01 | Đối chiếu sau lỗi điểm danh không xóa ghi chú mới đang chờ | Đạt ca lịch sử | T; I12:267 |
| R11-01 | S1 chờ lưu không kéo theo dữ liệu cũ làm mất sửa mới của S2 | Đạt ca lịch sử | T; I12:272–280 |
| R12-01 | Yêu cầu lưu cũ thành công đến muộn không đè chỉnh sửa mới | Đạt ca lịch sử | T; I12:285; I13:89 nhóm; I16:R15-03 |
| R15-01 | Duyệt cũ tới muộn không ghi đè bản sửa mới; chờ lưu nháp và duyệt đúng phiên bản | Đạt ca đã thử | I16:R15-01; duyệt cũ bị chặn, duyệt mới hợp lệ thành công. |
| R15-02 | Kết quả AI cũ không thay dữ liệu mới | Đạt ca gốc; còn mở rộng | I16:R15-02; R17-01/02 còn mở bảo vệ bản duyệt và phản hồi thiếu dữ kiện. |
| R15-03 | Bảo toàn dữ liệu giữa các lần mở trang, phản ánh đúng kết quả lưu | Đạt ca gốc; còn mở rộng | I16:R15-03; I17:R16-04-detail; SM:noteConflictFixed; R17-04 còn mở so sánh Quick Tags. |
| R15-04 | Kiểm tra active/điểm danh trước khi ghi LMS | Đạt ca đã thử | I16:R15-04; I17:13 ca R16-05 gồm PRESENT/LATE, 10 ca trước click và 1 ca sau click. |
| R15-05 | Chờ phân trang DOM hoàn tất rồi đọc đủ bảng điểm | Đạt phân trang DOM; còn nhánh mạng | I16:R15-05; I17:9 ca DOM; R17-03 còn mở bảo toàn cache qua GraphQL. |
| R15-06 | Đóng SSE phải gỡ đăng ký nhận nhật ký và trạng thái | Đạt ca đã thử | I16:R15-06; 40 luồng, không còn đăng ký nhận sự kiện. |
| R15-07 | Ẩn tên trong topic/keyKnowledge và dữ liệu đánh giá trước AI | Đạt phạm vi dữ liệu giả | I16:R15-07; T; không có tên ứng viên/bạn vắng trong prompt giả. |
| R16-01 | Phân trang DOM trễ 650 ms vẫn thu đủ | Đạt ca đã thử | T:3825; I16:R16-01; I17:0/100/650 ms có/không trống tải. |
| R16-02 | Không coi 0 dòng khi tải là hết trang; thiếu roster phải giữ cache | Đạt DOM; chưa đóng toàn quy tắc | T:3828; I16:R16-02; I17:9 ca DOM; R17-03 còn hở nhánh mạng. |
| R16-03 | Mọi nhánh AI bảo vệ phiên bản 0, bản duyệt và nội dung hiện có | Chưa đóng toàn diện | T:3835; I16:R16-03; I17:6 ca version 0 đạt; R17-01/02 trượt. |
| R16-04 | staleIgnored trả false, giữ bản nhập và hiển thị đúng bản đã lưu | Đạt ghi chú; chưa đủ Quick Tags | T:3957; I16:R16-04; I17:R16-04-detail đạt; SM:noteConflictFixed; R17-04 trượt. |
| R16-05 | Đọc lại điều kiện/nội dung ngay trước Save và kiểm tra sau ghi | Đạt ca đã thử | T:4036; I16:R16-05; I17:13 ca R16-05 đạt. |

## 7. Mức sẵn sàng cho Giai đoạn 5

| Phần | Đánh giá ở phiên này |
|---|---|
| Chạy cục bộ, dựng ứng dụng, TypeScript | Đạt; start/dev cấu hình 127.0.0.1; bản dựng thật chạy ở 127.0.0.1:3017. |
| Host/Origin, bí mật phía trình duyệt, đọc tệp qua giới hạn đường dẫn | Các ca cũ đạt; HTTP Origin ngoài bị từ chối; 14 gói JS không thấy tên biến nhạy cảm đã liệt kê. Không suy ra kiểm toán bí mật toàn diện từ phép tìm tên biến. |
| SQLite, bản nháp, duyệt, lưu phiên bản | Các ca nền tảng đạt; bảo vệ nội dung AI chưa đầy đủ ở R17-01/02. |
| Trình duyệt dùng chung, hàng đợi, sự kiện trực tiếp | Các ca mô phỏng độc lập đạt; không chạy nhiều tiến trình server cùng dùng một hồ sơ thật. |
| Ghi LMS, kiểm tra mạng và đọc lại | Các ca giả đã chạy đạt; kiểm tra trước Save mới đạt các biến thể đã nêu; chưa ghi LMS thật. |
| Đồng bộ lớp/lịch/điểm danh Teaching và LMS thật | Chưa nghiệm thu trong vòng này; không dùng tài khoản/dữ liệu thật. |
| Bảng điểm và xuất báo cáo | Hồi quy định dạng/điểm 0/trạng thái đạt; R17-03 còn có thể làm báo cáo thiếu học viên. |
| Thông báo/copy cho giáo viên | Zalo theo khóa đạt ca cũ; Copy nhận xét đang có R17-02; không gửi tin nhắn cho người khác. |
| Tính năng Giai đoạn 5 | Chưa triển khai/nghiệm thu trong phiên kiểm toán này; không đánh dấu hoàn thành các TASK-5.x. |

**Cổng mã nguồn: NO-GO.** Cần sửa và kiểm chứng lại bốn nhóm R17-01…04 trước khi đổi kết luận. Không cần sửa lại các phần đã đạt nếu không có bằng chứng lỗi mới. Build thành công và 148 nhóm cũ đạt không thay thế việc đóng các lỗi đã tái hiện.

Không thực hiện tra cứu lỗ hổng thư viện/CVE trực tuyến, kiểm tra xâm nhập hệ điều hành, kiểm thử tải nhiều máy, hoặc nghiệm thu tài khoản Teaching/LMS/Gemini thật. Không có kết luận về chất lượng sư phạm của nội dung AI thật hay nội dung từng giáo trình.

## 8. Bàn giao và bước tiếp theo

**Đã làm:** Đọc mã và bộ hồi quy, chạy đủ 6 lệnh bắt buộc, thêm kiểm chứng độc lập, đối chiếu 61 mã và lập hồ sơ Vòng 17. Không sửa sản phẩm.

**Kết quả:** Sáu lệnh bắt buộc đạt; 38 ca mở rộng cuối có 6 ca trượt thuộc 4 nhóm cần sửa. Giữ **NO-GO**. Bằng chứng và lịch sử được bảo toàn.

**Chưa kiểm tra:** Dữ liệu/tài khoản/dịch vụ thật và các giới hạn đã nêu ở mục 7.

**Việc tiếp theo:** Giao [yêu cầu sửa có phạm vi rõ](FIX_PROMPT.vi.md) cho người triển khai; sau bản sửa, chạy lại các ca trượt, ca đối chứng và sáu lệnh bắt buộc. Owner chưa cần thao tác kỹ thuật hoặc đăng nhập cho việc đóng các lỗi mã nguồn này.
