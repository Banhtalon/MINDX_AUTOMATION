# Báo cáo kiểm toán độc lập Vòng 16 — Giai đoạn 1–4

**Kết luận: NO-GO ở cấp mã nguồn để chuyển sang Giai đoạn 5.**

Ứng dụng giúp giáo viên đồng bộ lớp, soạn và duyệt nhận xét, ghi lên LMS, đọc bảng điểm và xuất báo cáo. Phạm vi tải được đánh giá là một giáo viên sử dụng ứng dụng trên máy cá nhân, có thể mở hai tab hoặc tải lại trang; tác vụ điều khiển LMS chạy tuần tự.

**Cả 5 lệnh bắt buộc đã được thực thi; tất cả đạt ở lần chạy hợp lệ cuối cùng, bao gồm build đủ 18/18 trang.** Hai bộ độc lập cũ đạt **43/43 + 89/89 = 132/132 nhóm**. Cả **7/7 kịch bản gốc R15-01…R15-07 đạt** khi đổi điều kiện kiểm tra sang hành vi đã sửa. Tuy nhiên, **5 ca mở rộng trượt, thuộc 4 nhóm lỗi cần sửa**. Do đó chưa thể xác nhận tuyên bố “7 lỗi đã được khắc phục triệt để”.

## 1. Nguồn được kiểm toán và cách giữ nguyên bằng chứng

- Thời điểm chụp: **2026-10-20T04:56:03.786Z**. Máy Windows, Node **v24.21.0**. Thời gian trong JSON/log là UTC; giờ Việt Nam bằng UTC + 7.
- HEAD tham chiếu: `2570d96b6770957e218031c91f14ce98e766dfa7`. Có nhiều thay đổi chưa commit ngay từ đầu. Kết luận áp dụng cho **nội dung trong cây làm việc đã chụp**, không áp dụng mặc nhiên cho riêng HEAD hay phiên bản tương lai.
- [source-state.json](source-state.json) ghi SHA-256 của **58 tệp** mã nguồn, kiểm thử, cấu hình và kế hoạch; SHA-256 của bản đồ 58 tệp: `7c2e54f0b847f68a819357b2fea6499f8f4d5cbe3ee90bec435078c1e0c1d6c0`.
- [snapshot-check.json](snapshot-check.json) xác nhận **58/58 tệp của bản sao khớp byte** với dự án ở đầu phiên. Bản sao chạy lệnh tại `C:\Users\QQ\AppData\Local\Temp\mindx-round16-lJw9AO`. Không sao chép tài khoản, tệp môi trường riêng, cơ sở dữ liệu thật hoặc hồ sơ đăng nhập thật.
- Dùng bản sao vì các script Vòng 12/13 tự ghi lại kết quả, còn Next.js có thể viết lại tệp khai báo kiểu khi build. Các thao tác này chỉ xảy ra trong bản sao. **Không sửa rồi khôi phục các hồ sơ lịch sử trong dự án gốc.**
- [preservation-check.json](preservation-check.json) đối chiếu SHA-256 và danh sách **77 tệp được bảo vệ**, gồm `next-env.d.ts` và toàn bộ Vòng 12/13/14/15. [final-state.json](final-state.json) xác nhận các tệp sản phẩm vẫn khớp đầu phiên; chỉ hồ sơ Vòng 16 và ghi chú AUDIT-R16 trong kế hoạch được thêm/cập nhật.
- Mã kiểm tra mới nằm riêng tại [verify-independent.mjs](verify-independent.mjs). Chỉ tái dùng bộ dựng dữ liệu giả và bộ chạy hàm giao diện của Vòng 12; điều kiện kiểm tra mới đọc mã sản phẩm hiện tại. Không thay mã sản phẩm để làm cho kiểm thử đạt.

## 2. Lệnh thật và kết quả

| Lệnh | Kết quả | Bằng chứng |
|---|---|---|
| `npx tsx scripts/test-phase4-codex-repros.ts` | Thoát 0; các nhóm Vòng 1–15 đạt | [regressions.log](regressions.log) |
| `node docs/audits/round-12/verify-independent.mjs` | Thoát 0; 43 đạt, 0 trượt | [log](round12-independent.log), [JSON](round12-independent-results.json) |
| `node docs/audits/round-13/verify-independent.mjs` | Thoát 0; 89 đạt, 0 trượt | [log](round13-independent.log), [JSON](round13-independent-results.json) |
| `npx tsc --noEmit --incremental false` | Thoát 0; không có lỗi kiểu | [typecheck.log](typecheck.log), [biên nhận lệnh](commands.json) |
| `npm run build` | Lần đầu lỗi bản sao thư viện; lần chạy sau thoát 0, biên dịch + TypeScript + 18/18 trang hoàn tất | [lỗi lần đầu](build.log), [build đầy đủ](build-full-dependencies.log) |
| `node docs/audits/round-16/verify-independent.mjs` | Thoát 1 đúng vì 5 ca phát hiện lỗi; **11 đạt, 5 trượt** | [independent-complete.log](independent-complete.log), [independent-results.json](independent-results.json) |
| `node docs/audits/round-16/smoke-local.mjs` | Thoát 0; chạy ứng dụng dựng sẵn, HTTP và Chromium thật trên 127.0.0.1:3016; xác nhận 2 lỗi | [smoke-results.json](smoke-results.json), [log](smoke-local.log) |

Lần build đầu dùng liên kết thư mục thư viện nên Turbopack từ chối tìm gói nằm ngoài bản sao. Đã thay liên kết bằng **bản sao thư viện đầy đủ**, giữ nguyên mã và cấu hình sản phẩm, rồi chạy lại đúng `npm run build`. Build thành công sau đó; lỗi chuẩn bị này không phải lỗi sản phẩm. [commands.json](commands.json) giữ cả lần thất bại và lần thành công, thời điểm, mã thoát, thư mục chạy và băm log. Không dùng kết quả log qua đường ống để suy ra mã thoát.

Script Vòng 15 lưu điều kiện để **tái hiện lỗi cũ**, ví dụ kỳ vọng còn đăng ký SSE hoặc SQLite chứa chữ cũ. Chạy nguyên các điều kiện đó không có nghĩa kiểm tra bản sửa đạt. Vòng 16 đã đọc và đối chiếu từng kịch bản trong tệp lịch sử, rồi viết điều kiện xác nhận hành vi đúng riêng; giữ nguyên toàn bộ tệp Vòng 15.

Các thông báo “old bulk network failure” trong log hồi quy là lỗi giả được chủ động tạo để kiểm tra xử lý thất bại; lệnh hồi quy vẫn thoát 0. Log TypeScript rỗng là kết quả hợp lệ, có biên nhận mã thoát 0.

## 3. Các lỗi cần sửa trước Giai đoạn 5

P1 = ưu tiên cao vì có thể mất dữ liệu hoặc ghi lên LMS ngoài điều kiện đã duyệt. P2 = lỗi chức năng cần sửa, có thể làm mất chỉnh sửa hoặc chặn báo cáo. Không có kết luận về khai thác từ Internet trong các phát hiện này.

### 3.1. R16-03 — P1: Yêu cầu “chưa đủ thông tin” cũ thay mất nhận xét mới đã duyệt

**Nguyên nhân:** Bộ soạn AI kiểm tra phiên bản sau khi nhận kết quả AI, nhưng nhánh không có Quick Tags/ghi chú ghi ngay vào SQLite trước khi đi qua lớp kiểm tra đó. Nhánh này không kiểm tra `expectedRowVer`.

**Vị trí:** `src/lib/gemini/comment-generator.ts:174` và lệnh ghi tại dòng 192; đối chiếu lớp kiểm tra ở dòng 445–470. Đường gọi thật: `src/app/api/session-comments/generate-ai/route.ts`.

**Cách tái hiện và bằng chứng:** Trang cũ giữ phiên bản 1 và danh sách thẻ/ghi chú rỗng. Một thao tác mới đã lưu `LATEST APPROVED TEXT` và duyệt thành `APPROVED`. Gửi yêu cầu soạn từ trang cũ sau đó. Nội dung mới bị thay bằng “Chưa đủ thông tin để nhận xét…”, trạng thái thành `INSUFFICIENT_INFO`, dù không gọi AI lần nào. [Ca R16-03](independent-results.json) chạy SQLite thật trong bộ nhớ; [staleInsufficient](smoke-results.json) xác nhận qua API ứng dụng dựng sẵn và SQLite cục bộ giả.

**Cách sửa tối thiểu:** Kiểm tra phiên bản và trạng thái hiện hành trước **mọi** nhánh ghi, bao gồm INSUFFICIENT_INFO; yêu cầu cũ chỉ trả kết quả bị bỏ qua và giữ nguyên dữ liệu. Khi đầu vào thiếu thông tin, không thay mất nhận xét đã có bằng câu thông báo giao diện. Xử lý rõ phiên bản 0, không xem 0 là lý do bỏ bảo vệ.

**Sau khi sửa:** Ca R16-03 phải giữ nguyên `finalText`, trạng thái, mã băm và nội dung mới; yêu cầu thiếu dữ kiện hợp lệ vẫn không được gọi Gemini. Liên quan phạm vi chưa đóng toàn diện của R15-02.

### 3.2. R16-05 — P1: Đã chuyển sang vắng nhưng tác vụ vẫn bấm Save lên LMS

**Nguyên nhân:** Tác vụ đọc active/điểm danh và nội dung một lần trước khi mở, tìm, điền form. Sau nhiều bước chờ bất đồng bộ, chương trình bấm Save mà không kiểm tra lại. Lần kiểm tra tiếp theo diễn ra sau nút Save và sau khi đọc lại.

**Vị trí:** `src/lib/playwright/save-comments.ts:245` kiểm tra ban đầu; dòng 610 bấm Save; dòng 678 mới đọc lại điều kiện từ SQLite.

**Cách tái hiện và bằng chứng:** Bản đầu có mặt và đã duyệt. Trong lúc điền ô soạn thảo, API lưu nháp cập nhật điểm danh thành `ABSENT` và hạ về DRAFT. Worker vẫn bấm Save **1 lần**. Sau đó worker giữ DRAFT và không đánh dấu VERIFIED, nhưng thao tác gửi đã xảy ra. [R16-05](independent-results.json) đếm nút Save trong trình duyệt giả và dùng SQLite thật trong bộ nhớ; không ghi LMS thật trong vòng này.

**Cách sửa tối thiểu:** Sau khi điền và đóng toast, đọc lại active, điểm danh, trạng thái duyệt, nội dung và mã băm ngay trước bước gửi; nếu khác thì thoát trước khi đăng ký/chạy thao tác Save. Vẫn giữ kiểm tra sau ghi để phát hiện thay đổi xảy ra khi yêu cầu đã gửi.

**Sau khi sửa:** Ca thay đổi trước nút Save phải có số lần gửi bằng 0; ca thay đổi sau khi gửi vẫn không được biến thành VERIFIED. Liên quan phần mở rộng của R15-04; ca gốc “đã nghỉ trước khi bắt đầu worker” đã được sửa đúng.

### 3.3. R16-01/R16-02 — P2: Chờ phân trang chưa đủ, có thể lưu bảng điểm thiếu mà báo thành công

**Nguyên nhân:** Vòng chờ mới chỉ tối đa **20 × 15ms, khoảng 300ms** cộng thời gian đọc DOM. Khi số dòng tạm thời bằng 0 hoặc khác trang cũ, vòng chờ kết thúc ngay; nút trang tiếp đang tạm khóa lúc tải có thể bị hiểu là hết trang. Phần kiểm tra cuối chỉ dùng tổng trên nhãn nếu có và số học viên active tối thiểu.

**Vị trí:** `src/lib/playwright/scrape-scores.ts:815`–836, nhất là dòng 822; đối chiếu kiểm tra tổng cuối hàm ở dòng 851 trở đi và bước lưu cache tại dòng 570.

**Cách tái hiện và bằng chứng:**

- R16-01: cùng kịch bản hai trang của Vòng 15, tăng độ trễ từ 100ms lên 650ms. Worker đọc lại trang 0, báo trùng học viên ở trang 2 khi trang mới còn đang tải.
- R16-02: chuyển trang hiển thị tạm 0 dòng và khóa nút Next. Danh sách giả có 2 học viên, gồm 1 active và 1 inactive; không có nhãn tổng. Toàn bộ `scrapeClassScores` trả `success: true` với 1 học viên. Bản lưu SQLite thật trong bộ nhớ bị thay từ **2 dòng xuống 1 dòng**. Không chỉ kiểm tra hàm con hoặc đếm lời gọi lưu giả.

Xem [independent-results.json](independent-results.json), ca R16-01/R16-02. Ca gốc 100ms vẫn đạt; vì vậy R15-05 chưa được đóng toàn diện.

**Cách sửa tối thiểu:** Chờ một điều kiện xác nhận trang mới đã tải ổn định trong thời hạn phù hợp; số dòng bằng 0 trong lúc tải không phải dấu hiệu xong. Không coi nút Next tạm khóa là hết dữ liệu. Nếu không xác minh được đã đọc đủ thì báo lỗi và giữ cache cũ; kiểm tra cả các học viên cần báo cáo, gồm inactive.

**Sau khi sửa:** Chuyển trang tức thì/100ms/650ms và màn hình trống tạm thời đều phải thu đủ; trang kẹt, vượt 50 trang hoặc dữ liệu thiếu phải thất bại an toàn và không đổi cache.

### 3.4. R16-04 — P2: Chỉnh sửa bị bỏ qua nhưng màn hình vẫn hiển thị như đã lưu

**Nguyên nhân:** API có chủ đích trả `success: true, staleIgnored: true` để chặn bản cũ. Hàm giao diện chỉ kiểm tra lỗi HTTP và `success === false`, nhận metadata rồi trả `true`; không báo xung đột và không đối chiếu nội dung đang hiển thị với nội dung đã lưu.

**Vị trí:** `src/app/api/session-comments/save-draft/route.ts:269`–281; `src/app/session-comments/page.tsx:752`–779.

**Cách tái hiện và bằng chứng:** Mở hai tab ở cùng phiên bản. Tab A lưu ghi chú mới; sau đó tab B nhập một ghi chú khác. API tab B trả 200 cùng `staleIgnored: true`. Tab B vẫn hiện `SECOND PAGE USER EDIT`; SQLite chứa `FIRST PAGE SAVED`; F5 đưa về chữ của tab A. Không có thông báo xung đột. [smoke-results.json](smoke-results.json) xác nhận bằng Chromium và ứng dụng thật, [ảnh dữ liệu giả](silent-conflict.png); bộ logic độc lập R16-04 xác nhận cùng hành vi. Sửa thêm lần nữa có thể lưu được vì metadata đã cập nhật, nhưng không cứu được lần nhập trước nếu giáo viên đóng/tải lại trang.

**Cách sửa tối thiểu:** Xử lý riêng `staleIgnored`: không trả kết quả “đã lưu”; giữ bản nhập để giáo viên so sánh, hiển thị xung đột dễ hiểu và đọc lại phiên bản đã lưu theo đúng lớp/buổi/học viên. Không tự gửi lại bản cũ để ghi đè người đang sửa ở tab khác.

**Sau khi sửa:** Mỗi chỉnh sửa phải hoặc lưu bền vững, hoặc hiển thị rõ chưa lưu do xung đột; không được âm thầm mất sau F5. Cơ chế R15-03 đã chặn ghi đè ở SQLite đúng, nhưng đường phản hồi giao diện còn thiếu.

## 4. Đối chiếu từng hạng mục Giai đoạn 1–4

“Đạt mã nguồn” là đạt phạm vi kiểm tra nêu trong bảng, không phải nghiệm thu dữ liệu/tài khoản LMS thật. Không tự chuyển các task Giai đoạn 5 sang hoàn thành.

| Hạng mục | Đánh giá Vòng 16 | Bằng chứng / giới hạn |
|---|---|---|
| TASK-1.1 — Next.js, TypeScript, chỉ chạy nội bộ | Đạt mã nguồn và khởi động bản dựng | dev/start gắn 127.0.0.1; build 18/18; ứng dụng thật chạy tại 127.0.0.1:3016. |
| TASK-1.2 — Thư viện và điều khiển giao diện | Đạt dựng và màn hình nhận xét đã thử | Chromium nạp giao diện, nhập ghi chú, đọc lại; không thử mọi điều khiển bằng tay. |
| TASK-1.3 — Thư viện xử lý nền | Đạt cài sẵn/biên dịch/nạp trong kiểm thử | Không cài hoặc nâng thư viện trong dự án; phiên bản thật nằm ở security-check.json. |
| TASK-1.4 — Cấu hình, thông tin nhạy cảm, giới hạn thư mục | Đạt các ca đã thử | .gitignore, cấu hình công khai đã che tài khoản; kiểm tra Host/Origin; quét tập tin JavaScript gửi trình duyệt không thấy tên biến mật khẩu/khóa đã liệt kê. |
| TASK-1.5 — SQLite, định danh, nháp/hash | Cấu trúc đạt; luồng bảo toàn còn lỗi | 7 bảng; khóa học viên theo lớp, chặn đổi chủ submissionId; thêm versionMetaJson vào bảng cũ không mất chữ. R16-03/04 còn ảnh hưởng dữ liệu nhận xét. |
| TASK-1.6 — Kho cấu hình JSON | Đạt kiểm tra đọc và giới hạn đường dẫn | Đọc cấu hình hiện tại, kiểm tra đường dẫn thoát ra ngoài bị chặn; không sửa kho thật. |
| TASK-1.7 — Dữ liệu mẫu khóa học | Đạt kiểm tra hiện có | 14 mã: PTA/PTB/PTI, JSB/JSA/JSI, SB/SA/SI, GB/GA/GI, ROB, CSI. Không nghiệm thu nội dung sư phạm từng buổi. |
| TASK-2.1 — Một trình duyệt dùng chung và khôi phục | Đạt ca mô phỏng độc lập | 8 lời gọi đồng thời tạo 1 context, khôi phục 1 tab, mở lại sau đóng; kiểm thử UI dùng 1 persistent context riêng trong bản sao. |
| TASK-2.2 — Hàng đợi tuần tự, dừng/tiếp tục | Đạt ca độc lập | Tối đa 1 tác vụ chạy; 2 tác vụ chờ bị hủy; chặn thêm khi dừng; tiếp tục được. R15-06 gỡ đăng ký đạt 40 luồng SSE. |
| TASK-2.3 — Bộ chọn phần tử LMS/Teaching | Đã đọc và đối chiếu mã; chưa xác nhận website thật | Bộ chọn tập trung; ca giả xác nhận ràng buộc lớp/buổi/học viên. Không khẳng định DOM LMS hiện tại khớp mọi bộ chọn. |
| TASK-2.4 — Kiểm tra và tự đăng nhập | Đã đọc luồng; chưa nghiệm thu đăng nhập thật | Các route đẩy tác vụ vào hàng đợi; thông tin tài khoản ở máy chủ. Không sử dụng tài khoản thật trong vòng này. |
| TASK-2.5 — Mở lớp, mạng nghiệp vụ, toast, phân trang | Ràng buộc mạng đạt; phân trang điểm chưa đạt toàn diện | HTTP lỗi/GraphQL lỗi/yêu cầu sai đích bị chặn; R16-01/02 còn trượt ở nhánh bảng điểm DOM. |
| TASK-3.1 — Đồng bộ lớp, buổi, học viên và điểm danh | Ca đồng bộ giả đạt; chưa nghiệm thu đủ yêu cầu thật | Không ghi đè bằng đồng bộ rỗng, mã theo lớp ổn định qua nhiều trang. Luồng hiện tại đồng bộ một lớp từ LMS; chưa xác nhận đọc lịch Teaching và điểm danh thật tự động. UI có bước giáo viên xác nhận điểm danh. |
| TASK-3.2 — AI 3 phần, ẩn danh, thiếu dữ kiện | Chưa đạt toàn diện | R15-02/R15-07 gốc đạt; còn R16-03 gây mất bản duyệt ở nhánh thiếu dữ kiện. |
| TASK-3.3 — Thông báo Zalo | Đạt ca mã nguồn đã thử | Nội dung theo khóa, không áp ghi chú GML cho khóa Python, không gán lịch cứng; chức năng Copy do giáo viên gửi, không gửi Zalo thật. |
| TASK-3.4 — Ghi LMS và đọc lại đối chiếu | Chưa đạt toàn diện | So đầy đủ nội dung + HTTP 200/201 + không có lỗi GraphQL đạt; ngăn VERIFIED khi bị sửa đạt; còn R16-05 gửi sau khi điều kiện đã đổi. |
| TASK-3.5 — Màn hình nhận xét, nháp, duyệt, LMS, Copy | Chưa đạt toàn diện | Duyệt cũ bị chặn và sửa nháp thông thường đạt; còn xung đột bị giấu ở R16-04; chỉ dùng dữ liệu giả cho thử UI thật. |
| TASK-4.1 — Đọc toàn bộ bảng điểm, 4 trạng thái | Chưa đạt toàn diện | Điểm 0, tách Quiz, trạng thái bài nộp, kiểm tra cache sai đều đạt; R16-01/02 chặn nghiệm thu phân trang đầy đủ. |
| TASK-4.2 — Xuất Excel/CSV/Google Sheets | Đạt xử lý xuất trong các ca đã thử; phụ thuộc đầu vào | Chặn công thức và ký tự lệch hàng/cột, giữ điểm 0 và trạng thái. Chưa thể bảo đảm báo cáo đủ học viên khi TASK-4.1 còn lỗi. |

## 5. Bảng đủ 56 mã lỗi

**49/49 mã lịch sử đạt các điều kiện kiểm tra còn lưu; 7/7 ca gốc Vòng 15 đạt.** Trong phạm vi mở rộng, 4 mã Vòng 15 còn vấn đề liên quan (R15-02/03/04/05), nên không báo “56/56 đã đóng toàn diện”. 49 mã lịch sử là mã lỗi; 132 nhóm là nhóm kiểm thử, không cộng lẫn hai loại số lượng.

Quy ước: **T** = hồi quy dự án đã chạy mới; **I12:n** = nhóm tại dòng n của tệp độc lập Vòng 12 đã chạy lại; **I13** = 89 nhóm độc lập Vòng 13 đã chạy lại; **I16:mã** = ca trong bộ kiểm tra mới. Các mã A01–A14 là ca con của Vòng 2, không cộng thêm vào 56. R16-01…R16-05 là các ca phát hiện bổ sung, trình bày riêng ở mục 3.

| Mã | Tiêu chí được đối chiếu | Trạng thái Vòng 16 | Bằng chứng mới / giới hạn |
|---|---|---|---|
| #1 | Đọc lại đầy đủ nhận xét, từ chối nội dung thừa | Đạt ca lịch sử | T; I12:117 |
| #2 | Phản hồi nghiệp vụ thành công và nội dung đọc lại phải đúng | Đạt ca lịch sử | T; I12:117,144 — có HTTP 500/lỗi GraphQL |
| #3 | Khóa đúng lớp, buổi, học viên | Đạt ca lịch sử | T; I12:117,158 |
| #4 | Đọc nhiều trang; không phá dữ liệu khi đồng bộ rỗng | Đạt ca lịch sử | T; I12:179 |
| #5 | Sửa trong lúc lưu LMS không biến nháp mới thành VERIFIED | Đạt ca lịch sử | T; I12:117 — giữ DRAFT |
| #6 | Điền nội dung như văn bản, không thực thi thẻ HTML | Đạt ca lịch sử | T; I12:125 |
| #7 | Trùng tên vẫn tách mã; dữ liệu điểm sai không ghi đè bản lưu | Đạt ca lịch sử | T; I12:158,190 |
| #8 | Phân biệt điểm 0, chưa chấm, chưa nộp, làm lại | Đạt ca lịch sử | T; I12:166 |
| #9 | Chặn công thức bảng tính và ký tự làm lệch hàng/cột | Đạt ca lịch sử | T; I12:224 |
| #10 | Đổi lớp/đọc lại không xuất bảng điểm cũ | Đạt ca lịch sử | T; I12:240 |
| #11 | Tách Quiz và thực hành, giữ điểm 0 và trạng thái xuất | Đạt ca lịch sử | T; I12:158,166,224 |
| #12 | Không bịa 14 buổi; Zalo theo khóa, không gán lịch cứng | Đạt ca lịch sử | T; I12:179,231 |
| #13 | AI lọc học viên đủ điều kiện; thiếu dữ kiện không tự viết | Đạt ca lịch sử | T; I12:212; I16:R15-02 — giữ đúng thiếu dữ kiện không gọi AI; nhánh ghi INSUFFICIENT_INFO cũ còn R16-03. |
| #14 | Đọc cấu hình qua giới hạn đường dẫn cho phép | Đạt ca lịch sử | T; I12:231 |
| R2-01 | A01 — So toàn bộ nội dung đã duyệt | Đạt ca lịch sử | T; I12:117 |
| R2-02 | A09 — Lọc đúng thao tác và định danh yêu cầu mạng | Đạt ca lịch sử | T; I12:133,144 |
| R2-03 | A02 — Tên ngắn không khớp một phần tên dài | Đạt ca lịch sử | T; I12:152 |
| R2-04 | A11 — Mã học viên ổn định khi đổi thứ tự danh sách | Đạt ca lịch sử | T; I12:179 |
| R2-05 | A03/A05 — Chặn lớp chưa xác thực, danh sách sai, trùng tên mơ hồ | Đạt ca lịch sử | T; I12:158 |
| R2-06 | A04/A06 — Thiếu bài nộp hoặc ma trận không hợp lệ bị chặn | Đạt ca lịch sử | T; I12:158,190 |
| R2-07 | A12 — Phát hiện trang trùng/kẹt/vượt giới hạn | Đạt ca lịch sử | T; I12:172 — chặn trang trùng/kẹt và giới hạn 50 trang; mở rộng tải chậm/trống có R16-01/02. |
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
| R3-07 | Ẩn tên trong ghi chú và thẻ trước khi gọi AI | Đạt ca lịch sử | T; I12:212; I16:R15-07 — ghi chú, thẻ, chủ đề, kiến thức và tên bạn cùng lớp giả được ẩn. |
| R4-01 | Danh sách lớp cũ đến muộn không thay lớp mới | Đạt ca lịch sử | T; I12:243 |
| R4-02 | Định danh mâu thuẫn hoặc yêu cầu chỉ có nhận xét bị chặn | Đạt ca lịch sử | T; I12:133 |
| R4-03 | Đọc điểm lỗi khi tải bản lưu phải tắt cả hai trạng thái chờ | Đạt ca lịch sử | T; I12:240 |
| R4-04 | Thiếu columnId/maxScore/score bị từ chối | Đạt ca lịch sử | T; I12:190 |
| R4-05 | Gọi trực tiếp AI với buổi khác lớp cũng bị chặn | Đạt ca lịch sử | T; I12:212 |
| R4-06 | Hết 50 trang vẫn còn trang tiếp phải báo chưa đọc đủ | Đạt ca lịch sử | T; I12:172 |
| R5-01 | Đổi buổi cùng lớp bỏ hàng cũ, chặn lưu/duyệt nhầm buổi | Đạt ca lịch sử | T; I12:243 |
| R5-02 | Duyệt bản cũ không làm sai trạng thái/nội dung bản vừa sửa | Đạt ca lịch sử | T; I12:252; I16:R15-01 — cả phản hồi muộn và yêu cầu duyệt tới muộn đều được chặn. |
| R5-03 | Trường định danh/nội dung null bị chặn ở mọi tầng yêu cầu | Đạt ca lịch sử | T; I12:133 — 15 trường × 3 vị trí |
| R5-04 | Đổi lớp rồi đọc điểm lỗi ngay không tạo GET thừa gây treo | Đạt ca lịch sử | T; I12:240 |
| R6-01 | API nháp/duyệt chỉ chấp nhận học viên đúng lớp, đang học; duyệt PRESENT/LATE | Đạt ca lịch sử | T; I12:202; I16:R15-04 — đúng lớp, active và PRESENT/LATE tại API; đổi điều kiện ngay trước Save có R16-05. |
| R7-01 | Sửa ghi chú/thẻ/điểm danh lưu DRAFT qua đọc lại | Đạt ca lịch sử | T; I12:264, I13 mở rộng |
| R8-01 | Điểm danh cả lớp có lỗi không báo tất cả thành công | Đạt ca lịch sử | T; I12:261 — 400/500/lỗi mạng/nghỉ học |
| R9-01 | Phản hồi lưu lỗi cũ không khôi phục đè dòng mới/lớp mới | Đạt ca lịch sử | T; I12:258,267 |
| R10-01 | Đối chiếu sau lỗi điểm danh không xóa ghi chú mới đang chờ | Đạt ca lịch sử | T; I12:267 |
| R11-01 | S1 chờ lưu không kéo theo dữ liệu cũ làm mất sửa mới của S2 | Đạt ca lịch sử | T; I12:272–280 — 16 tổ hợp |
| R12-01 | Yêu cầu lưu cũ thành công đến muộn không đè chỉnh sửa mới | Đạt ca lịch sử | T; I12:285; I13:89 nhóm; I16:R15-03 — bản cũ không đè SQLite, kể cả qua hai trang và khởi tạo lại route. Lỗi thông báo xung đột UI được ghi riêng ở R16-04. |
| R15-01 | Duyệt cũ tới muộn không ghi đè bản sửa mới; chờ lưu nháp và duyệt đúng phiên bản | Đạt | T:3105; I16:R15-01; SQLite approveConditional kiểm tra phiên bản/nội dung trong giao dịch. |
| R15-02 | Kết quả AI cũ không thay dữ liệu mới | Đạt ca gốc; chưa đóng toàn diện | I16:R15-02 đạt; R16-03 trượt nhánh INSUFFICIENT_INFO; xác nhận thêm qua HTTP ứng dụng thật. |
| R15-03 | Bảo toàn dữ liệu giữa các lần mở trang, phản ánh đúng kết quả lưu | Chặn ghi đè đạt; UI còn lỗi | I16:R15-03 đạt cả route được tạo lại; R16-04 trượt: staleIgnored bị UI coi là đã lưu. Chromium thật xác nhận F5 mất sửa. |
| R15-04 | Kiểm tra active/điểm danh trước khi ghi LMS | Đạt ca gốc; chưa đóng toàn diện | I16:R15-04 đạt; R16-05 trượt nếu đổi ABSENT trong lúc điền trước nút Save. Không báo VERIFIED sai, nhưng vẫn bấm Save. |
| R15-05 | Chờ phân trang DOM hoàn tất rồi đọc đủ bảng điểm | Đạt 100ms; còn lỗi | I16:R15-05 đạt; R16-01 trượt 650ms; R16-02 báo thành công và ghi cache thiếu một học viên. |
| R15-06 | Đóng SSE phải gỡ đăng ký nhận nhật ký và trạng thái | Đạt | I16:R15-06: 40 luồng, abort riêng/cancel riêng/cả hai/đã abort từ trước; 0 đăng ký còn lại. |
| R15-07 | Ẩn tên trong topic/keyKnowledge và dữ liệu đánh giá trước AI | Đạt trong phạm vi đã thử | T:3194; I16:R15-07 — tên ứng viên và bạn vắng cùng lớp đều được thay; không gọi Gemini thật. |

Tổng kiểm đếm: **14 + 11 + 7 + 6 + 4 + 7 + 7 = 56 mã riêng biệt**. Có bản máy đọc được tại [issue-status.json](issue-status.json).

## 6. Kiểm tra chất lượng của bộ hồi quy

Đã đối chiếu các điều kiện kiểm tra và đường gọi của `scripts/test-phase4-codex-repros.ts` với sản phẩm, đặc biệt khối Vòng 15 từ dòng 3015 đến 3667:

- R15-01 trong hồi quy chủ yếu kiểm tra chờ nháp; ca độc lập mới bổ sung yêu cầu duyệt cũ **chưa tới máy chủ** rồi tới sau chỉnh sửa mới.
- R15-02 kiểm tra ghi chú thay đổi khi AI đang chờ, có ca đối chứng học viên không bị sửa vẫn nhận nhận xét. Chưa kiểm tra nhánh trả INSUFFICIENT_INFO từ yêu cầu cũ; đó là R16-03.
- R15-03 kiểm tra trang trước tới muộn không đè trang mới. Chưa kiểm tra cách UI báo cho người dùng khi một chỉnh sửa bị bỏ qua; R16-04 kiểm tra logic và Chromium thật.
- R15-04 chỉ tái kiểm tra học viên đã inactive trước khi chạy. Vòng 16 bổ sung ABSENT/UNKNOWN/EXCUSED và kiểm tra số lần gửi; còn R16-05 ở thời điểm giữa điền và Save.
- R15-05 chỉ thử trễ 100ms. Vòng 16 thêm 650ms và màn hình trống lúc tải; cả hai trượt. Ca màn hình trống chạy tới bước ghi cache SQLite thật.
- R15-06 cũ kết hợp abort và cancel. Vòng 16 tách từng trường hợp, cả trường hợp đã abort từ trước; tổng 40 luồng, không còn đăng ký sau đóng.
- R15-07 kiểm tra tên trong chủ đề/kiến thức. Vòng 16 thêm tên bạn vắng cùng lớp trong chủ đề, kiến thức và ghi chú; đạt trong dữ liệu giả đã thử.

Bộ hồi quy hiện tại có giá trị, nhưng dòng “đạt 100%” chỉ chứng minh các điều kiện nó thực thi, không chứng minh các tình huống chưa có kiểm thử. Các ca mới đang thất bại được giữ nguyên để người sửa có tiêu chí cụ thể.

## 7. Giới hạn và bước sửa tiếp theo

Không đăng nhập Teaching/LMS thật; không ghi nhận xét/điểm lên LMS, không gửi Zalo hoặc gọi Gemini thật. Không đọc tên học viên thật hay dùng cơ sở dữ liệu/hồ sơ đăng nhập của Owner. Kiểm thử Chromium chạy trên bản dựng thật nhưng dữ liệu và máy chủ đều là bản sao cục bộ. Worker LMS được kiểm tra bằng phần tử trình duyệt giả; vì vậy phát hiện số lần Save là bằng chứng logic, không phải biên nhận từ LMS thật.

Không nghiệm thu trọn bộ giao diện bằng tay, nội dung sư phạm của từng khóa, hay luồng tải/chấm bài Giai đoạn 5 chưa triển khai. Kiểm tra thêm cột versionMetaJson chỉ xác nhận nâng cấp đó, không chứng nhận mọi lịch sử cấu trúc SQLite từng tồn tại. Kết quả quét JavaScript trình duyệt chỉ giới hạn ở các tên biến và mẫu khóa được liệt kê trong [security-check.json](security-check.json).

**Thứ tự sửa đề nghị:** R16-03 → R16-05 → R16-01/02 → R16-04. Sau sửa, chạy lại năm lệnh bắt buộc, bộ ca Vòng 16 và ca UI thật với dữ liệu giả trên đúng mã nguồn mới. Chỉ đổi kết luận khi các ca bảo toàn dữ liệu đều đạt; việc build thành công riêng lẻ không đóng các lỗi trên.

### Prompt sửa có thể giao cho người thực hiện

> Sửa đúng 4 nhóm lỗi được xác nhận trong docs/audits/round-16/REPORT.vi.md: (1) bảo vệ phiên bản cho cả nhánh INSUFFICIENT_INFO của CommentGenerator, giữ nguyên bản nhận xét mới đã duyệt; (2) đọc lại active/điểm danh/nội dung/hash/trạng thái ngay trước khi bấm Save LMS, vẫn giữ kiểm tra sau ghi; (3) chờ phân trang DOM tải xong, không coi màn hình trống hoặc Next tạm khóa là hết dữ liệu, không ghi cache khi chưa đủ; (4) xử lý staleIgnored trên UI bằng thông báo xung đột và giữ bản nhập để so sánh, không báo đã lưu. Thay đổi tối thiểu và bổ sung các ca R16-01…R16-05 vào bộ hồi quy sản phẩm. Không sửa điều kiện kiểm tra để che lỗi; giữ nguyên từng byte next-env.d.ts và hồ sơ Vòng 12–16. Chạy năm lệnh bắt buộc và cung cấp bằng chứng trên đúng bản mã mới. Chưa triển khai Giai đoạn 5 trong task sửa này.

**Đã làm:** Kiểm toán mã nguồn và bộ kiểm thử, thực thi đủ lệnh, đối chiếu 56 mã, bổ sung điều kiện độc lập, xác nhận hai lỗi bằng ứng dụng thật với dữ liệu giả.

**Kết quả:** NO-GO cấp mã nguồn cho Giai đoạn 5; build và các ca cũ đạt nhưng còn 4 nhóm lỗi, thể hiện qua 5 ca trượt.

**Chưa kiểm tra:** Nghiệm thu bằng tài khoản/dữ liệu LMS, Teaching và Gemini thật; toàn bộ Giai đoạn 5.

**Việc tiếp theo:** Giao sửa bốn nhóm lỗi trong phạm vi trên, rồi kiểm toán lại mã nguồn sau sửa. Owner không cần tự chạy lệnh hoặc xử lý mã nguồn.
