# Báo cáo kiểm toán độc lập Vòng 15 — MINDX Automation Bot

Ngày **20/10/2026**, giờ Việt Nam. Phạm vi: Giai đoạn 1–4 và **49 mã lỗi lịch sử Vòng 1–12**, trước khi triển khai Giai đoạn 5.

**Kết luận: NO-GO ở cấp mã nguồn để chuyển sang Giai đoạn 5.**

Đã chạy thật đủ **5/5 lệnh bắt buộc**, tất cả thoát `0`. Bộ độc lập Vòng 12 đạt **43/43**, Vòng 13 đạt **89/89**; bản dựng hoàn tất **18/18 trang**. Tuy nhiên, các ca kiểm chứng mới tái hiện được **7 lỗi bổ sung: 4 P1 và 3 P2**. Hai mã lịch sử **R5-02 và R12-01 cần mở lại với phạm vi rộng hơn**. Vì vậy, kết quả kiểm tra cũ đạt không đồng nghĩa đủ điều kiện chuyển giai đoạn.

Ứng dụng hỗ trợ giáo viên lưu nhận xét buổi học, chuẩn bị thông báo Zalo và tổng hợp/xuất bảng điểm trên máy cá nhân. Mức sử dụng được đánh giá là **một giáo viên, một tiến trình máy chủ, một trình duyệt tự động dùng chung**; giáo viên vẫn có thể sửa trong lúc tác vụ chạy, chuyển màn hình hoặc mở lại trang. Không giả định tải nhiều người dùng hay triển khai máy chủ công cộng.

**1. Phạm vi, cách kiểm chứng và giới hạn bằng chứng**

- Thư mục: `F:\MINDX_project test\MINDX-AUTOMATION`. HEAD nền: `2570d96b6770957e218031c91f14ce98e766dfa7`; Node `v24.21.0`, Next.js `16.4.2`, Windows.
- Checkout có nhiều thay đổi chưa commit từ trước. Kết luận gắn với SHA-256, tức dấu vân tay từng byte của file trong [source-state.json](source-state.json), không chỉ với HEAD. Đã ghi [trạng thái Git đầu phiên](git-status.before.txt).
- Đã đọc trực tiếp toàn bộ hai trang được yêu cầu, tất cả 12 file route trong `src/app/api/`, và toàn bộ file trong `src/lib/playwright/`, `src/lib/db/`, `src/lib/gemini/`, `src/lib/zalo/`, `src/lib/security/`. Đã đọc thêm cấu hình, hàng đợi, trang tổng quan, bố cục và thanh nhật ký để theo luồng gọi đến nơi đọc/ghi dữ liệu.
- Đã đối chiếu kế hoạch, bộ kiểm tra của dự án, hai bộ độc lập và hồ sơ Vòng 12–14; đọc tài liệu Route Handlers và TypeScript đi kèm đúng phiên bản Next.js trong `node_modules/next/dist/docs/`.
- **Không có báo cáo gốc riêng Vòng 1–11 trong checkout.** Tiêu chí 49 mã được khôi phục từ các bài kiểm tra còn lưu, bảng ánh xạ tại `scripts/test-phase4-codex-repros.ts:2010` và hồ sơ Vòng 12–14. Không chứng nhận thêm các yêu cầu trong tài liệu gốc không được cung cấp.
- Vòng 15 viết các khẳng định mới. Chỉ dùng lại phần dựng SQLite trong bộ nhớ, bộ mô phỏng điều phối trạng thái trang và đối tượng Playwright giả từ đầu file Vòng 12; không lấy kết quả cũ làm kết quả mới. Các hàm sản phẩm được đọc từ file hiện tại khi chạy.
- SQLite trong các ca tái hiện là SQLite thật ở chế độ `:memory:`. Các ca giao diện chạy phần xử lý trang với lịch xử lý có kiểm soát, không chạy bộ hiển thị React trong trình duyệt thật. Các ca Playwright chạy mã điều khiển thật với trang/LMS giả; **không chứng minh lỗi đã xảy ra trên LMS thật**.
- Đã khởi động tạm bản dựng trên địa chỉ `127.0.0.1`, kiểm tra HTTP của hai trang chính và các yêu cầu bị chặn, rồi dừng đúng tiến trình tạm. Đây là kiểm tra chạy ứng dụng, không phải kiểm tra thao tác giao diện bằng mắt.
- Không đăng nhập, gửi nhận xét, đồng bộ lớp thật hoặc gọi Gemini thật trong vòng này. Không xuất giá trị `.env.local`, mật khẩu, khóa API hay tên học viên thật. Lệnh build chuẩn của dự án có thể gọi `getDb()` từ trang tổng quan để mở SQLite/khởi tạo bảng bằng `CREATE TABLE IF NOT EXISTS`; vì vậy không tuyên bố build hoàn toàn không chạm file dữ liệu. Các ca tái hiện không dùng file SQLite của ứng dụng.
- Yêu cầu người dùng ghi `gpt-6.1-sol` / `xhigh`; công cụ của phiên này không cung cấp chứng thực tên mô hình hoặc mức suy luận, nên đây không phải một thuộc tính đã được đo bằng lệnh CLI. Kết luận dựa trên mã, lệnh thực thi và dữ liệu tái hiện.

**2. Kết quả các lệnh đã thực thi**

Tất cả chạy từ thư mục gốc dự án, trên cùng mã sản phẩm. [run-checks.mjs](run-checks.mjs) giữ mã thoát thật, ghi cả đầu ra và lỗi; không dùng đường ống có thể làm mất mã lỗi. Chi tiết thời gian và dấu vân tay nhật ký nằm trong [commands.json](commands.json). Năm lệnh chạy từ **11:07:16 đến 11:07:25 ngày 20/10/2026**, UTC+7.

| Lệnh | Mã thoát | Kết quả | Bằng chứng mới |
|---|---:|---|---|
| `npx tsx scripts/test-phase4-codex-repros.ts` | 0 | Các ca hồi quy hiện có đạt | [regressions.log](regressions.log) |
| `node docs/audits/round-12/verify-independent.mjs` | 0 | **43 đạt, 0 lỗi** | [nhật ký](round12-independent.log), [JSON](round12-independent-results.json) |
| `node docs/audits/round-13/verify-independent.mjs` | 0 | **89 đạt, 0 lỗi** | [nhật ký](round13-independent.log), [JSON](round13-independent-results.json) |
| `npx tsc --noEmit --incremental false` | 0 | Kiểm tra kiểu dữ liệu đạt, không có thông báo lỗi | [typecheck.log](typecheck.log) |
| `npm run build` | 0 | Biên dịch, TypeScript, tạo **18/18 trang**, tối ưu hóa hoàn tất | [build.log](build.log) |
| `node docs/audits/round-15/verify-independent.mjs` | 0 | **Tái hiện 7 lỗi**, 3 nhóm kiểm tra nền tảng đạt, 0 lỗi thực thi công cụ | [mã tái hiện](verify-independent.mjs), [JSON](independent-results.json) |
| `node docs/audits/round-15/smoke-local.mjs` | 0 | Hai trang HTTP 200; 4 yêu cầu có nguồn bên ngoài HTTP 403; đã dừng máy chủ tạm | [JSON](smoke-results.json), [nhật ký máy chủ](smoke-server.log) |

Mã thoát `0` của **công cụ tái hiện Vòng 15** có nghĩa công cụ xác nhận được hiện tượng lỗi mong đợi, **không có nghĩa sản phẩm đạt**. JSON phân biệt `CONFIRMED_BUG` và `BASELINE_PASS`. Tổng 132 nhóm cũ dùng chung một phần bộ mô phỏng, không phải 132 phép đo độc lập hoàn toàn.

Nhật ký hồi quy có các dòng lỗi mạng giả do ca kiểm tra cố ý tạo ra; chúng được kiểm tra bằng khẳng định và toàn bộ lệnh kết thúc `0`. Không đổi các thông báo đó thành lỗi mạng thật của hệ thống.

**3. Đánh giá theo Giai đoạn 1–4**

| Giai đoạn | Kết quả ở cấp mã nguồn | Căn cứ và giới hạn |
|---|---|---|
| 1 — Cấu hình, SQLite, kho nội dung | Nền tảng đã kiểm tra đạt; cơ chế bảo vệ ghi dữ liệu còn thiếu | Có 7 bảng; khóa học viên theo lớp tách biệt; chặn đổi chủ `submissionId`; đọc cấu hình qua giới hạn đường dẫn; dev/start chỉ định `127.0.0.1`. Lỗi R15-01/02/03 cho thấy băm nội dung chưa bảo vệ được mọi đường ghi nhận xét. |
| 2 — Trình duyệt dùng chung, hàng đợi, đăng nhập | Đạt ca dùng chung và tuần tự trong mô phỏng; **chưa đạt toàn bộ** | 8 yêu cầu mở đồng thời chỉ tạo 1 context ban đầu; khôi phục tab và mở lại sau đóng đạt; hàng đợi chỉ chạy 1 tác vụ, hủy tác vụ chờ và tiếp tục được. Kết nối nhật ký chưa giải phóng đúng khi đóng: R15-06. Chưa thử đăng nhập thật. |
| 3 — Nhận xét, AI, Zalo, ghi LMS | **Không đạt** | R15-01/02/03 gây mất chỉnh sửa hoặc duyệt sai phiên bản; R15-04 không kiểm tra lại học viên đã nghỉ; R15-07 còn lộ tên trong chủ đề/kiến thức gửi AI. Các ca cũ về băm, đọc lại đầy đủ, đúng lớp/buổi, thiếu dữ kiện, Zalo theo khóa vẫn đạt theo phạm vi từng ca. |
| 4 — Bảng điểm và xuất báo cáo | **Chưa đạt tình huống tải trang chậm** | Đọc điểm 0, trạng thái bài nộp, tách Quiz, bảo vệ dữ liệu xuất và giới hạn phân trang đạt các ca cũ. Nhánh đọc DOM có lỗi chuyển trang bất đồng bộ: R15-05. Chưa đối chiếu toàn bộ điểm với LMS thật. |

Các mục Giai đoạn 5–7 chưa làm không bị tính là lỗi của Giai đoạn 1–4. Các hàm lưu bài tập/SPCK hiện là phần nền; chưa có nghiệm thu chấm bài, đọc file hay tải SPCK thật.

**4. Phát hiện cần sửa trước khi chuyển giai đoạn**

P1: ưu tiên cao, ảnh hưởng tính đúng hoặc làm mất dữ liệu đã lưu trong luồng đang dùng. P2: mức trung bình, cần xử lý nhưng phạm vi hẹp hơn. Không phát hiện nào dưới đây dựa chỉ trên suy đoán; mỗi mục có ca chạy trong [verify-independent.mjs](verify-independent.mjs).

**R15-01 — P1 — Yêu cầu duyệt đến muộn ghi đè bản mới và duyệt lại bản cũ**

- **Nguyên nhân:** Máy chủ đọc bản hiện có nhưng không kiểm tra nội dung/phiên bản mà giáo viên duyệt có còn là bản hiện tại hay không. Nó băm `approvedText` trong yêu cầu rồi ghi lại toàn bộ `finalText` với trạng thái `APPROVED`. Kiểm tra phiên bản trên giao diện chỉ bỏ qua phản hồi, không đảo được lần ghi sai trong SQLite.
- **Vị trí:** [approve/route.ts:60](../../../src/app/api/session-comments/approve/route.ts#L60), dòng 88–103; [session-comments/page.tsx:1010](../../../src/app/session-comments/page.tsx#L1010), dòng 1025–1031. Hàm `sessionFeedbackRepo.upsert` cho phép bản băm mới tương ứng văn bản cũ, nên cơ chế băm không chặn trường hợp này.
- **Tái hiện:** Có `old final`, điểm danh PRESENT → bấm Duyệt, giữ yêu cầu trước khi máy chủ xử lý → sửa và lưu thành công `LATEST TEACHER TEXT` → cho yêu cầu duyệt cũ chạy tiếp.
- **Quan sát:** Giao diện vẫn là `LATEST TEACHER TEXT`, `DRAFT`, trả kết quả duyệt `false`; **SQLite trở về `old final`, `APPROVED`, mã băm khớp bản cũ**. Worker ghi LMS có thể lấy bản cũ đã được đánh dấu duyệt này. Ca tại [verify-independent.mjs:32](verify-independent.mjs#L32).
- **Cách sửa nhỏ nhất:** Duyệt có điều kiện theo phiên bản hiện có trong SQLite, kiểm tra trong cùng một thao tác cập nhật; trả lỗi xung đột nếu dữ liệu đã đổi. Chờ lưu nháp hoàn tất trước khi duyệt. Không chỉ thêm kiểm tra phản hồi ở giao diện.
- **Sau khi sửa:** Cả thứ tự yêu cầu đến muộn và phản hồi đến muộn phải giữ văn bản mới trong SQLite, trên trang và sau tải lại; bản cũ không được `APPROVED` hay chuyển sang worker LMS. **Mở lại phạm vi R5-02.**

**R15-02 — P1 — AI trả muộn ghi đè chỉnh sửa và khôi phục điểm danh cũ**

- **Nguyên nhân:** Sau khi chờ Gemini, bộ sinh AI ghi cả ghi chú, thẻ, điểm danh và nhận xét từ đầu vào cũ mà không so với dữ liệu hiện tại. Trang chỉ kiểm tra mã yêu cầu AI/lớp/buổi; không kiểm tra giáo viên vừa sửa dòng nào trong lúc chờ.
- **Vị trí:** [comment-generator.ts:290](../../../src/lib/gemini/comment-generator.ts#L290), dòng 357–371; [session-comments/page.tsx:925](../../../src/app/session-comments/page.tsx#L925), dòng 934–958.
- **Tái hiện:** Gọi AI khi S1 PRESENT, ghi chú `old S1` → giữ phản hồi AI → giáo viên lưu ghi chú mới, nhận xét mới và đổi sang ABSENT → trả kết quả AI hợp lệ dựa trên dữ liệu cũ.
- **Quan sát:** SQLite bị đưa lại thành ghi chú `old S1`, điểm danh **PRESENT**, nhận xét `AI RESULT FROM OLD INPUT`; trang vẫn hiển thị ABSENT và ghi chú mới nhưng nhận xét đã bị thay bằng AI. Đây là mất dữ liệu đã lưu và lệch giữa trang với SQLite. Ca tại [verify-independent.mjs:49](verify-independent.mjs#L49).
- **Cách sửa nhỏ nhất:** Gắn kết quả AI với phiên bản dữ liệu đầu vào, kiểm tra lại khi ghi; không ghi trả các trường ghi chú/thẻ/điểm danh cũ. Nếu có chỉnh sửa mới, giữ bản mới và báo kết quả AI cần xem lại. Giao diện cũng phải bỏ kết quả của dòng đã đổi phiên bản.
- **Sau khi sửa:** Sửa ghi chú, thẻ, văn bản hoặc điểm danh trong khi AI chạy đều phải giữ nguyên sau trả kết quả và tải lại; hai yêu cầu AI cùng phạm vi hoàn tất ngược thứ tự cũng cần được bảo vệ ở máy chủ. Giữ các ca R3-06 và R7–R12 đang đạt.

**R15-03 — P1 — Yêu cầu lưu của lần mở trang cũ có thể đè lần mở trang mới**

- **Nguyên nhân:** Bộ nhớ chống yêu cầu cũ được chia theo `clientInstanceId`. Mỗi lần tạo trang có một mã mới, nên máy chủ không so thứ tự giữa hai lần mở trang cho cùng học viên. Một yêu cầu cũ đến muộn từ trang trước được coi là mới trong nhóm riêng của nó.
- **Vị trí:** [save-draft/route.ts:5](../../../src/app/api/session-comments/save-draft/route.ts#L5), dòng 102–122; [session-comments/page.tsx:132](../../../src/app/session-comments/page.tsx#L132), dòng 698–705.
- **Tái hiện:** Trang A gửi `OLDER PAGE EDIT`, yêu cầu bị giữ → mở trang B cùng lớp/buổi/học viên, lưu thành công `LATEST NEW PAGE EDIT` → yêu cầu trang A tới máy chủ sau đó. Tình huống tương ứng mở hai tab hoặc chuyển màn hình rồi quay lại khi yêu cầu trang cũ còn đang xử lý.
- **Quan sát:** Hai mã trang khác nhau; SQLite và trang B sau đọc lại đều thành **`OLDER PAGE EDIT`**. Ca tại [verify-independent.mjs:76](verify-independent.mjs#L76).
- **Cách sửa nhỏ nhất:** Dùng phiên bản dữ liệu được lưu trong SQLite cho cùng bản ghi, kiểm tra điều kiện cập nhật giữa mọi bên ghi; khi xung đột, không âm thầm ghi đè. Không so trực tiếp hai bộ đếm cục bộ từ hai trang như thể chúng cùng một đồng hồ. Giữ việc lưu độc lập các trường không liên quan theo yêu cầu hồi quy hiện tại.
- **Sau khi sửa:** Bản mới phải tồn tại qua mở lại trang và xử lý yêu cầu cũ; kiểm tra cả hai tab và việc dựng lại bộ xử lý route. **R12-01 đạt trong cùng một lần mở trang, nhưng chưa đóng ở phạm vi vòng đời trang.** Bộ nhớ hiện tại cũng không tồn tại qua khởi động lại; giới hạn này thấy từ mã, chưa được tính thêm thành một ca lỗi đã chạy riêng.

**R15-04 — P1 — Vẫn ghi nhận xét đã duyệt khi học viên đã chuyển sang nghỉ học**

- **Nguyên nhân:** Worker chọn bản theo trạng thái/hash; đọc học viên hiện tại chỉ để lấy tên, không kiểm tra lại `isActive`. Việc đồng bộ danh sách có thể đổi `isActive` sau khi duyệt mà không hạ trạng thái nhận xét cũ.
- **Vị trí:** [save-comments.ts:105](../../../src/lib/playwright/save-comments.ts#L105), dòng 231–279; đối chiếu [sync-class.ts:138](../../../src/lib/playwright/sync-class.ts#L138), nơi cập nhật danh sách học viên.
- **Tái hiện:** Khi đang học và PRESENT, S1 có nhận xét APPROVED, hash đúng → cập nhật trạng thái học viên thành `isActive=0`, như một lần đồng bộ mới → chạy worker lưu nhận xét.
- **Quan sát:** Cả ca đối chứng đang học và ca đã nghỉ đều có `verifiedCount=1`, SQLite thành `VERIFIED`. Đường ghi cho học viên đã nghỉ không bị chặn. LMS/HTTP/DOM được mô phỏng hợp lệ trong ca này. Ca tại [verify-independent.mjs:97](verify-independent.mjs#L97).
- **Cách sửa nhỏ nhất:** Kiểm tra lại học viên còn thuộc lớp, đang học và điểm danh đủ điều kiện ở thời điểm chuẩn bị ghi; không chỉ kiểm tra lúc duyệt. Nếu đã đổi điều kiện, dừng dòng đó và báo rõ cần xem lại.
- **Sau khi sửa:** Ca đang học/PRESENT vẫn thành công; ca đã nghỉ, mất thành viên hoặc không còn điểm danh đủ điều kiện không được click Save và không được VERIFIED. Các ca API từ chối duyệt học viên nghỉ của R6-01 vẫn phải đạt.

**5. Phát hiện mức trung bình**

**R15-05 — P2 — Đọc bảng điểm quá sớm sau bấm trang tiếp theo**

- **Nguyên nhân:** Nhánh DOM bấm nút trang tiếp, tăng số trang rồi đọc ngay các hàng, không chờ dữ liệu trang mới xuất hiện. Việc nút đã được bấm không đảm bảo LMS đã tải xong hàng mới.
- **Vị trí:** [scrape-scores.ts:811](../../../src/lib/playwright/scrape-scores.ts#L811), dòng 696–740.
- **Tái hiện:** Bảng có hai trang, mỗi trang một học viên; trang thứ hai cập nhật sau 100 ms. Dữ liệu đối chứng cập nhật ngay được đọc đủ hai dòng.
- **Quan sát:** Với 100 ms, hàm vẫn ở trang dữ liệu đầu nhưng báo **trùng dòng/phân trang kẹt tại trang 2** và hủy cào. Cơ chế bảo vệ vẫn giữ cache cũ, nhưng một lớp hợp lệ nhiều trang có thể không cập nhật được điểm. Ca tại [verify-independent.mjs:123](verify-independent.mjs#L123).
- **Cách sửa nhỏ nhất:** Chờ dấu hiệu xác định trang đã đổi, như khoảng phân trang hoặc mã hàng đầu tiên thay đổi, kèm thời hạn rõ ràng; sau đó mới áp dụng kiểm tra trùng. Không chỉ thêm thời gian ngủ cố định.
- **Sau khi sửa:** Trang cập nhật ngay, sau 100 ms và sau khoảng trễ lớn hơn đều đọc đủ; nút bị kẹt, trang trùng thật và giới hạn 50 trang vẫn bị từ chối như R2-07/R4-06.

**R15-06 — P2 — Đóng luồng nhật ký không gỡ người nghe**

- **Nguyên nhân:** Route trả hàm dọn dẹp từ `ReadableStream.start()`. Luồng dữ liệu web không dùng giá trị trả về đó làm hàm dọn dẹp khi đóng. Route không có `cancel()` và không theo dõi `req.signal` để gỡ đăng ký.
- **Vị trí:** [queue/stream/route.ts:13](../../../src/app/api/queue/stream/route.ts#L13), dòng 14–41; [live-log-drawer.tsx:14](../../../src/components/live-log-drawer.tsx#L14) mở kết nối khi giao diện được gắn vào trang.
- **Tái hiện:** Mở, hủy yêu cầu và đóng body của 3 luồng liên tiếp bằng `Request`, `Response`, `ReadableStream` thật; theo dõi số hàm đã đăng ký với hàng đợi.
- **Quan sát:** Sau đóng vẫn còn **3 đăng ký log + 3 đăng ký trạng thái**. Các đăng ký giữ controller đã đóng; mỗi sự kiện sau đó vẫn gọi chúng rồi nuốt lỗi. Tải lại hoặc tự kết nối lại nhiều lần làm bộ nhớ/công việc thừa tăng dần. Ca tại [verify-independent.mjs:143](verify-independent.mjs#L143).
- **Cách sửa nhỏ nhất:** Một hàm dọn dẹp có thể gọi nhiều lần an toàn, được gọi từ `cancel()` và tín hiệu ngắt yêu cầu; gỡ cả hai đăng ký.
- **Sau khi sửa:** Sau mỗi lần đóng hoặc mất kết nối, số đăng ký trở về mức trước khi mở; một kết nối đang mở vẫn nhận đủ log và trạng thái.

**R15-07 — P2 — Tên học viên trong chủ đề/kiến thức vẫn được gửi nguyên sang AI**

- **Nguyên nhân:** Mã ẩn danh chỉ áp dụng cho ghi chú và Quick Tags. `session.topic` và `session.keyKnowledge` được ghép thẳng vào prompt. Ô chủ đề trên giao diện cho phép giáo viên sửa, nên tên học viên có thể xuất hiện khi ghi nội dung như dự án hoặc thuyết trình cá nhân.
- **Vị trí:** [comment-generator.ts:235](../../../src/lib/gemini/comment-generator.ts#L235), dòng 248–260; [session-comments/page.tsx:908](../../../src/app/session-comments/page.tsx#L908) gửi các trường này.
- **Tái hiện:** Dùng tên giả `Audit S1`; ghi chủ đề `Dự án của Audit S1` và kiến thức `Audit S1 thuyết trình`, đồng thời đặt cùng tên trong ghi chú/thẻ; chặn lời gọi mô hình để đọc prompt trong bộ nhớ.
- **Quan sát:** Tên trong ghi chú/thẻ được ẩn, nhưng **tên trong chủ đề và kiến thức còn nguyên trong prompt chuẩn bị gửi**. Không có dữ liệu thật hoặc lời gọi Gemini thật trong ca này. Ca tại [verify-independent.mjs:157](verify-independent.mjs#L157).
- **Cách sửa nhỏ nhất:** Dùng cùng bộ thay tên cho toàn bộ trường văn bản tự do trước khi ghép prompt, bao gồm chủ đề và kiến thức; đối chiếu với danh sách học viên đã biết của lớp.
- **Sau khi sửa:** Prompt không còn tên giả ở bất kỳ trường nào; mã STUDENT vẫn ánh xạ đúng về học viên khi nhận kết quả. R3-07 cũ chỉ chứng minh ghi chú/thẻ đã được ẩn danh.

**6. Bảng trạng thái đủ 49 mã lịch sử Vòng 1–12**

Quy ước: **Đạt ca cũ** = lệnh mới trong Vòng 15 đã chạy và đạt tiêu chí còn lưu của mã đó; không có nghĩa đã đóng mọi tình huống liên quan. **Mở lại** = ca cũ đạt nhưng ca mới cùng yêu cầu bảo toàn dữ liệu đã trượt. Tổng: **47 đạt ca cũ, 2 cần mở lại**. Cả 49 mã đều có ca cũ chạy đạt, nhưng không báo “49/49 đã đóng toàn diện”.

Tên bằng chứng: `T` = bộ hồi quy dự án; `I12:n` = nhóm bắt đầu tại dòng n trong bộ độc lập Vòng 12, đã chạy lại tại phiên này; `I13` = bộ độc lập Vòng 13, đã chạy lại; `N15-xx` = ca tái hiện mới R15-xx. Các JSON kết quả mới được liên kết ở mục 2.

| Mã | Tiêu chí lịch sử còn kiểm chứng được | Trạng thái Vòng 15 | Bằng chứng mới / giới hạn |
|---|---|---|---|
| #1 | Đọc lại đầy đủ nhận xét, từ chối nội dung thừa | Đạt ca cũ | T; I12:117 |
| #2 | Phản hồi nghiệp vụ thành công và nội dung đọc lại phải đúng | Đạt ca cũ | T; I12:117,144 — có HTTP 500/lỗi GraphQL |
| #3 | Khóa đúng lớp, buổi, học viên | Đạt ca cũ | T; I12:117,158 |
| #4 | Đọc nhiều trang; không phá dữ liệu khi đồng bộ rỗng | Đạt ca cũ | T; I12:179 |
| #5 | Sửa trong lúc lưu LMS không biến nháp mới thành VERIFIED | Đạt ca cũ | T; I12:117 — giữ DRAFT |
| #6 | Điền nội dung như văn bản, không thực thi thẻ HTML | Đạt ca cũ | T; I12:125 |
| #7 | Trùng tên vẫn tách mã; dữ liệu điểm sai không ghi đè bản lưu | Đạt ca cũ | T; I12:158,190 |
| #8 | Phân biệt điểm 0, chưa chấm, chưa nộp, làm lại | Đạt ca cũ | T; I12:166 |
| #9 | Chặn công thức bảng tính và ký tự làm lệch hàng/cột | Đạt ca cũ | T; I12:224 |
| #10 | Đổi lớp/đọc lại không xuất bảng điểm cũ | Đạt ca cũ | T; I12:240 |
| #11 | Tách Quiz và thực hành, giữ điểm 0 và trạng thái xuất | Đạt ca cũ | T; I12:158,166,224 |
| #12 | Không bịa 14 buổi; Zalo theo khóa, không gán lịch cứng | Đạt ca cũ | T; I12:179,231 |
| #13 | AI lọc học viên đủ điều kiện; thiếu dữ kiện không tự viết | Đạt ca cũ | T; I12:212; việc đổi dữ kiện trong lúc chờ còn lỗi N15-02 |
| #14 | Đọc cấu hình qua giới hạn đường dẫn cho phép | Đạt ca cũ | T; I12:231 |
| R2-01 | A01 — So toàn bộ nội dung đã duyệt | Đạt ca cũ | T; I12:117 |
| R2-02 | A09 — Lọc đúng thao tác và định danh yêu cầu mạng | Đạt ca cũ | T; I12:133,144 |
| R2-03 | A02 — Tên ngắn không khớp một phần tên dài | Đạt ca cũ | T; I12:152 |
| R2-04 | A11 — Mã học viên ổn định khi đổi thứ tự danh sách | Đạt ca cũ | T; I12:179 |
| R2-05 | A03/A05 — Chặn lớp chưa xác thực, danh sách sai, trùng tên mơ hồ | Đạt ca cũ | T; I12:158 |
| R2-06 | A04/A06 — Thiếu bài nộp hoặc ma trận không hợp lệ bị chặn | Đạt ca cũ | T; I12:158,190 |
| R2-07 | A12 — Phát hiện trang trùng/kẹt/vượt giới hạn | Đạt ca cũ | T; I12:172; tải trang chậm có lỗi dừng nhầm N15-05 |
| R2-08 | A10 — Đổi lớp/đọc điểm không treo trạng thái chờ | Đạt ca cũ | T; I12:240 |
| R2-09 | A07/A08 — API nháp/duyệt/AI kiểm tra thành viên và điểm danh | Đạt ca cũ | T; I12:202,212; không bao phủ các race N15-01/02 |
| R2-10 | A12/A14 — Quiz riêng, MARKED thiếu điểm bị chặn | Đạt ca cũ | T; I12:158,166 |
| R2-11 | A13 — AI thiếu nội dung trả FAILED, không tạo nhận xét thay thế | Đạt ca cũ | T; I12:212,255 |
| R3-01 | Nội dung thừa cùng dòng/xuống dòng/tab không được VERIFIED | Đạt ca cũ | T; I12:117 |
| R3-02 | Yêu cầu mạng rỗng hoặc sai buổi bị chặn | Đạt ca cũ | T; I12:133 |
| R3-03 | Sai danh sách dù cùng số lượng hoặc trùng tên thiếu mã bị chặn | Đạt ca cũ | T; I12:158 |
| R3-04 | Trạng thái, điểm, mã cột không hợp lệ bị chặn | Đạt ca cũ | T; I12:190 |
| R3-05 | Tra học viên bắt buộc theo lớp, AI thiếu định danh không chạy | Đạt ca cũ | T; I12:190,212 |
| R3-06 | AI lỗi/lưu ghi chú riêng không xóa nhận xét đang có | Đạt ca cũ | T; I12:202,255; AI thành công đến muộn chưa được bảo vệ: N15-02 |
| R3-07 | Ẩn tên trong ghi chú và thẻ trước khi gọi AI | Đạt ca cũ | T; I12:212; trường chủ đề/kiến thức có N15-07 |
| R4-01 | Danh sách lớp cũ đến muộn không thay lớp mới | Đạt ca cũ | T; I12:243 |
| R4-02 | Định danh mâu thuẫn hoặc yêu cầu chỉ có nhận xét bị chặn | Đạt ca cũ | T; I12:133 |
| R4-03 | Đọc điểm lỗi khi tải bản lưu phải tắt cả hai trạng thái chờ | Đạt ca cũ | T; I12:240 |
| R4-04 | Thiếu columnId/maxScore/score bị từ chối | Đạt ca cũ | T; I12:190 |
| R4-05 | Gọi trực tiếp AI với buổi khác lớp cũng bị chặn | Đạt ca cũ | T; I12:212 |
| R4-06 | Hết 50 trang vẫn còn trang tiếp phải báo chưa đọc đủ | Đạt ca cũ | T; I12:172 |
| R5-01 | Đổi buổi cùng lớp bỏ hàng cũ, chặn lưu/duyệt nhầm buổi | Đạt ca cũ | T; I12:243 |
| R5-02 | Duyệt bản cũ không làm sai trạng thái/nội dung bản vừa sửa | **Mở lại** | T/I12:252 đạt nhánh phản hồi muộn; **N15-01 trượt nhánh yêu cầu tới muộn**, SQLite thành APPROVED bản cũ |
| R5-03 | Trường định danh/nội dung null bị chặn ở mọi tầng yêu cầu | Đạt ca cũ | T; I12:133 — 15 trường × 3 vị trí |
| R5-04 | Đổi lớp rồi đọc điểm lỗi ngay không tạo GET thừa gây treo | Đạt ca cũ | T; I12:240 |
| R6-01 | API nháp/duyệt chỉ chấp nhận học viên đúng lớp, đang học; duyệt PRESENT/LATE | Đạt ca cũ | T; I12:202; worker sau khi điều kiện đổi có lỗi riêng N15-04 |
| R7-01 | Sửa ghi chú/thẻ/điểm danh lưu DRAFT qua đọc lại | Đạt ca cũ | T; I12:264, I13 mở rộng |
| R8-01 | Điểm danh cả lớp có lỗi không báo tất cả thành công | Đạt ca cũ | T; I12:261 — 400/500/lỗi mạng/nghỉ học |
| R9-01 | Phản hồi lưu lỗi cũ không khôi phục đè dòng mới/lớp mới | Đạt ca cũ | T; I12:258,267 |
| R10-01 | Đối chiếu sau lỗi điểm danh không xóa ghi chú mới đang chờ | Đạt ca cũ | T; I12:267 |
| R11-01 | S1 chờ lưu không kéo theo dữ liệu cũ làm mất sửa mới của S2 | Đạt ca cũ | T; I12:272–280 — 16 tổ hợp |
| R12-01 | Yêu cầu lưu cũ thành công đến muộn không đè chỉnh sửa mới | **Mở lại** | T/I12:285 và 89 nhóm I13 đạt trong phạm vi cũ; **N15-03 trượt giữa hai lần mở trang** |

Số lượng: **14 + 11 + 7 + 6 + 4 + 7 = 49**. Các mã A dưới đây là ca con của Vòng 2, không cộng thêm vào 49.

| Ca Vòng 2 | Ánh xạ | Trạng thái ca cũ chạy mới |
|---|---|---|
| A01 | R2-01 | Đạt |
| A02 | R2-03 | Đạt |
| A03 | R2-05 | Đạt |
| A04 | R2-06 | Đạt |
| A05 | R2-05 | Đạt |
| A06 | R2-06 | Đạt |
| A07 | R2-09 | Đạt |
| A08 | R2-09 | Đạt |
| A09 | R2-02 | Đạt |
| A10 | R2-08 | Đạt |
| A11 | R2-04 | Đạt |
| A12 | R2-07, R2-10 | Đạt |
| A13 | R2-11 | Đạt |
| A14 | R2-10 | Đạt |

**7. Bảo toàn mã và hồ sơ**

- Đã chụp dấu vân tay trước các lệnh. So với manifest Vòng 14, mọi file mã sản phẩm/test/cấu hình nằm trong mốc cũ đều khớp; chỉ kế hoạch có thêm ghi chú AUDIT-R14 sau thời điểm chụp mốc cũ. Hai file launcher được bổ sung vào phạm vi chụp của Vòng 15, không phải file sản phẩm mới do vòng này tạo. Xem [baseline-comparison.json](baseline-comparison.json).
- Các bộ độc lập cũ tự ghi vào file kết quả lịch sử. Công cụ đã sao kết quả mới sang Vòng 15 rồi khôi phục bản lịch sử trong `finally`, không ghi đè bằng chứng Vòng 12–14.
- `next-env.d.ts` đã được khôi phục bằng bản byte gốc sau build trong `finally`; SHA-256 phải khớp `b8b3a344484b959af5e4e3fc1a1609dac3cb9ece0cdeb6c145be29bc4c491000`.
- Không sửa mã sản phẩm hoặc test có sẵn; không commit/reset/xóa thay đổi có sẵn; không đổi cấu hình để vượt bước kiểm tra. Chỉ tạo hồ sơ Vòng 15 và thêm dòng AUDIT-R15 hoàn thành việc kiểm toán trong kế hoạch. Không đánh dấu lỗi đã sửa hoặc Giai đoạn 5 đã hoàn thành.
- [preservation-check.json](preservation-check.json) xác minh lại dấu vân tay sau cùng, kể cả hồ sơ lịch sử. `.next` chứa đầu ra build mới theo đúng lệnh được yêu cầu.

**8. Việc cần làm để xem xét GO**

Sửa R15-01/02/03 trước vì chúng dùng các đường ghi khác nhau cho cùng nhận xét. Bảo vệ phiên bản phải nằm ở SQLite/máy chủ và áp dụng cho nháp, duyệt, kết quả AI; chỉ bỏ qua phản hồi trên trang sẽ không ngăn mất dữ liệu. Giữ các ca hiện có về sửa các trường độc lập và không làm hỏng R7–R12. Sau đó chặn worker cho học viên không còn đủ điều kiện, sửa chờ phân trang, dọn kết nối nhật ký và ẩn danh toàn bộ đầu vào AI.

Khi sửa, chuyển các ca tái hiện thành kiểm tra yêu cầu đúng: hiện tại chúng cố ý khẳng định hiện tượng lỗi để làm bằng chứng, nên không được dùng mã thoát `0` của chúng làm nhãn sản phẩm đã sửa. Chạy lại đủ năm lệnh bắt buộc và các ca bảo vệ mới trên đúng dấu vân tay sau sửa; lập kết luận mới. Chưa cần Owner đăng nhập hay thao tác kỹ thuật để bắt đầu sửa các lỗi đã tái hiện.

Prompt giao việc có thể sao chép:

```text
Chỉ sửa các lỗi R15-01 đến R15-07 trong docs/audits/round-15/REPORT.vi.md.
Đọc kế hoạch và các file liên quan trước; bảo toàn mọi thay đổi có sẵn.
Ưu tiên ngăn mất chỉnh sửa: duyệt cũ, AI trả muộn, lưu nháp giữa các lần mở trang.
Kiểm tra phiên bản phải có hiệu lực ở nơi ghi SQLite, dùng chung giữa các đường ghi;
giữ khả năng lưu các trường độc lập và toàn bộ ca R7-R12 đang đạt.
Tiếp theo chặn worker khi học viên đã nghỉ, chờ đúng dữ liệu trang mới,
giải phóng kết nối nhật ký khi đóng và ẩn danh chủ đề/kiến thức trước khi gọi AI.
Không sửa tính năng Giai đoạn 5-7, không đăng nhập/ghi LMS hoặc gọi Gemini thật.
Chuyển ca tái hiện Vòng 15 thành kiểm tra yêu cầu đúng, chạy đủ năm lệnh bắt buộc,
khôi phục next-env.d.ts đúng từng byte; báo cáo file thay đổi và bằng chứng mới.
Không tự công bố GO cho tới khi kiểm chứng độc lập trên đúng mã sau sửa.
```

**Đã làm:** Đọc sâu mã nguồn Giai đoạn 1–4, chạy đủ lệnh, đối chiếu 49 mã, tái hiện 7 lỗi bổ sung và lưu hồ sơ độc lập.

**Kết quả:** **NO-GO cấp mã nguồn để chuyển sang Giai đoạn 5**, thay thế kết luận GO của Vòng 14 trên cùng mã sản phẩm; khác biệt là các ca Vòng 15 mở rộng phạm vi kiểm chứng, không phải do bước build bị lỗi.

**Chưa kiểm tra:** Đăng nhập/đồng bộ/ghi và đọc lại trên LMS/Teaching thật, chất lượng và kết nối Gemini thật, thao tác React trong trình duyệt thật, toàn bộ báo cáo điểm thật, lỗ hổng thư viện qua cơ sở dữ liệu công bố bên ngoài, và yêu cầu không còn hồ sơ gốc Vòng 1–11. Không chứng nhận ứng dụng không còn các lỗi khác.

**Việc tiếp theo:** Giao sửa 7 lỗi có bằng chứng, sau đó kiểm chứng lại; Owner chưa cần chạy lệnh hay cung cấp tài khoản.
