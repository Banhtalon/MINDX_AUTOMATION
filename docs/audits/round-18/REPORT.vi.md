# Kiểm toán độc lập Vòng 18 — xác minh Giai đoạn 1–4

**Kết luận: GO ở cấp mã nguồn để chuyển sang triển khai Giai đoạn 5.**

Bốn nhóm lỗi **R17-01, R17-02, R17-03, R17-04 đã được đóng trong phạm vi kiểm chứng**. Cả **7 lệnh bắt buộc thoát 0**; bản dựng hoàn tất **18/18 trang**; bốn bộ độc lập đạt **43 + 89 + 16 + 38 = 186/186 nhóm**, không có ca trượt. Kiểm tra giao diện cuối bằng Chromium, HTTP và SQLite thật với dữ liệu giả cũng đạt.

Kết luận này thay thế NO-GO của AUDIT-R17 đối với cây mã nguồn có dấu vân tay bên dưới. Đây là điều kiện để bắt đầu phát triển Giai đoạn 5; chưa phải nghiệm thu vận hành trên Teaching/LMS/Gemini thật, và không đánh dấu các TASK-5.x hoàn thành.

## 1. Phạm vi và nguồn đã kiểm

Ứng dụng hỗ trợ giáo viên đồng bộ lớp, soạn/duyệt/lưu nhận xét, thu thập bảng điểm và xuất báo cáo. Giả định một giáo viên dùng máy cá nhân, có thể mở hai tab; các thao tác điều khiển LMS chạy qua hàng đợi tuần tự.

- Ngày kiểm toán: **20/10/2026**. Chụp nguồn lúc **2026-10-20T05:52:18.121Z**, tức **12:52:18 giờ Việt Nam**.
- HEAD tham chiếu: `2570d96b6770957e218031c91f14ce98e766dfa7`. Có nhiều thay đổi chưa commit trước phiên kiểm toán, kể cả tệp chưa được Git theo dõi; xem [trạng thái ban đầu](git-status.before.txt). Kết luận áp dụng cho cây làm việc đã chụp, không chỉ cho HEAD.
- [source-state.json](source-state.json) lưu SHA-256, tức dấu vân tay nội dung, của **58 tệp**. Dấu vân tay bản đồ nguồn: `4405fa75120bcccff53c5686669cfe2f17a42e8ad1ebaec6a280cdf48d49bf5d`.
- So với nguồn Vòng 17, thay đổi nằm ở **3 tệp sản phẩm**, bộ hồi quy và kế hoạch: `src/lib/gemini/comment-generator.ts`, `src/app/session-comments/page.tsx`, `src/lib/playwright/scrape-scores.ts`, `scripts/test-phase4-codex-repros.ts`, `MINDX_AUTOMATION_PLAN.md`. Những tệp khác trong bản đồ nguồn khớp Vòng 17. Xem [review-scope.json](review-scope.json).
- Đã đọc các nhánh sửa, đường gọi giao diện/API, bảo vệ phiên bản và mã băm trong SQLite, bảo vệ đường dẫn/HTTP cục bộ, trình duyệt dùng chung, hàng đợi và điều kiện trước/sau ghi LMS. Đây là rà soát tập trung các luồng liên quan; không phải đọc lại từng dòng của toàn bộ kho mã.

## 2. Cách ly và bảo toàn

Các lệnh chạy trong bản sao **`C:\Users\QQ\AppData\Local\Temp\mindx-round18-etNeOk`**. Nguồn, script và lịch sử được sao chép rồi đối chiếu byte trước khi chạy. Thư viện cài sẵn được sao chép đầy đủ; không cài hoặc nâng phiên bản. [snapshot-check.json](snapshot-check.json) xác nhận không có tệp lệch.

Không sao chép `.env`, `.env.local`, cơ sở dữ liệu thật hoặc hồ sơ đăng nhập thật. Tiến trình con chỉ nhận danh sách biến hệ thống cần thiết; không thừa kế mật khẩu, tài khoản hoặc khóa dịch vụ. `npx` chạy ở chế độ dùng thư viện sẵn có, không tải gói từ mạng. Có lớp chặn kết nối Node ra ngoài máy; Chromium chỉ cho phép yêu cầu đến đúng địa chỉ ứng dụng cục bộ. Đây là biện pháp của bộ kiểm toán, không phải tường lửa hệ điều hành. Chi tiết ở [isolation.json](isolation.json) và [mã chặn mạng](network-guard.cjs).

AI trong các bộ kiểm tra là phản hồi giả; SQLite chạy thật trong bộ nhớ. Smoke dùng bản dựng thật, SQLite riêng chứa `Audit S1` và một hồ sơ Chromium riêng ở bản sao; không bấm đồng bộ, đăng nhập hoặc gửi LMS thật. Không gọi dịch vụ trả phí. Smoke cuối ghi **0 yêu cầu trang ra ngoài, 0 lỗi JavaScript trên trang**.

Các script lịch sử tự ghi kết quả vào thư mục cũ và build có thể viết lại `next-env.d.ts`; việc đó chỉ xảy ra trong bản sao. Trong dự án gốc, **149/149 tệp** thuộc `next-env.d.ts` và toàn bộ thư mục Vòng 12–17 được giữ nguyên byte và danh sách tệp. Không áp dụng cách sửa rồi khôi phục. **46 tệp** trong `src/`, `scripts/`, `data/config/` giữ nguyên ở cả bản gốc và bản sao sau kiểm tra. Xem [preservation-check.json](preservation-check.json), [final-state.json](final-state.json).

Chỉ thêm hồ sơ Vòng 18 và cập nhật AUDIT-R18 trong kế hoạch. Bản kế hoạch trước phiên được giữ ở [plan.before.md](plan.before.md); [plan.audit.diff](plan.audit.diff) cho thấy riêng phần thêm trong phiên.

## 3. Lệnh và kết quả mới

[commands.json](commands.json) ghi lệnh chính xác, thư mục chạy, giờ bắt đầu/kết thúc, mã thoát thật và SHA-256 log. Không lấy mã thoát của đường ống làm mã thoát kiểm thử.

| Lệnh | Kết quả mới | Bằng chứng |
|---|---|---|
| `npx tsx scripts/test-phase4-codex-repros.ts` | **Thoát 0**; gồm đầy đủ các nhãn R17-01…04 | [regressions.log](regressions.log) |
| `node docs/audits/round-12/verify-independent.mjs` | **Thoát 0; 43 đạt, 0 trượt** | [log](round12-independent.log), [JSON](round12-independent-results.json) |
| `node docs/audits/round-13/verify-independent.mjs` | **Thoát 0; 89 đạt, 0 trượt** | [log](round13-independent.log), [JSON](round13-independent-results.json) |
| `node docs/audits/round-16/verify-independent.mjs` | **Thoát 0; 16 đạt, 0 trượt** | [log](round16-independent.log), [JSON](round16-independent-results.json) |
| `node docs/audits/round-17/verify-independent.mjs` | **Thoát 0; 38 đạt, 0 trượt**, gồm cả 6 ca từng trượt | [log](round17-independent.log), [JSON](round17-independent-results.json) |
| `npx tsc --noEmit --incremental false` | **Thoát 0**, không lỗi kiểu dữ liệu | [typecheck.log](typecheck.log), [biên nhận](commands.json) |
| `npm run build` | **Thoát 0**; biên dịch, TypeScript và tạo **18/18 trang** hoàn tất | [build.log](build.log) |
| `node docs/audits/round-18/smoke-local.mjs` | **Lần hợp lệ cuối thoát 0**; hai luồng UI yêu cầu đều đạt | [log cuối](smoke-accepted.log), [JSON cuối](smoke-results.json), [mã kiểm tra](smoke-local.mjs) |

Log TypeScript rỗng là hợp lệ vì tiến trình thoát 0. Các lỗi mạng giả được in trong hồi quy là tình huống kiểm tra có chủ đích, không phải thất bại của lệnh. Bộ Vòng 16 gồm 7 kịch bản gốc R15, 5 kịch bản gốc R16 và 4 nhóm nền tảng. Các con số nhóm có phần kiểm tra chồng nhau; **186 không phải số lỗi riêng biệt hoặc số hành vi sản phẩm duy nhất**.

### Điều chỉnh bộ smoke và lưu các lần chưa hợp lệ

Giữ nguyên bằng chứng của cả ba lần chạy, kể cả mã thoát 1 của hai lần đầu trong `commands.json`:

1. [Lần đầu](smoke-local.log), [JSON](smoke-initial-results.json), [mã lúc chạy](smoke-local.initial.mjs): Copy và ba ô cũ đã đạt. Bộ smoke chờ URL kết thúc bằng `/save-draft`, trong khi ứng dụng gửi thêm chuỗi tham số sau dấu `?`, nên hết thời gian chờ dù thao tác đã gửi. Đã sửa bộ smoke để so đường dẫn URL, không sửa sản phẩm.
2. [Lần hai](smoke-final.log), [JSON](smoke-second-results.json), [mã lúc chạy](smoke-local.second.mjs): Chỉnh sửa nhận xét đã lưu thật, nhưng bộ smoke tự giả định trạng thái phải thành DRAFT. Yêu cầu R17-02 là giữ/hiển thị/sửa/copy nội dung; thao tác sửa chữ chưa bổ sung Quick Tags hoặc ghi chú làm dữ kiện cho AI. Vì vậy bỏ giả định trạng thái này và đối chiếu trực tiếp chữ đã lưu, tải lại và clipboard. JSON cuối vẫn ghi rõ trạng thái quan sát được là INSUFFICIENT_INFO; không khẳng định nút Duyệt được mở sau thao tác này.
3. [Lần cuối](smoke-accepted.log): toàn bộ tiêu chí trực tiếp về nội dung và hai tab đều đạt. Không thay đổi nguồn sản phẩm giữa các lần; không bỏ hoặc giảm các điều kiện Copy, ba phần nhận xét, bảo toàn dữ liệu hoặc hiển thị đúng thẻ xung đột.

## 4. Xác minh bốn lỗi Vòng 17

| Mã | Nguyên nhân và vị trí cũ | Bản sửa được kiểm | Kết quả độc lập |
|---|---|---|---|
| **R17-01 — P1** | Bản APPROVED/VERIFIED vẫn vào nhánh AI có dữ kiện | `comment-generator.ts:190`: kiểm trạng thái ngay sau phiên bản, trước cả hai nhánh | Cả APPROVED/VERIFIED × có/không thẻ: **0 lần gọi AI**, toàn bộ bản ghi SQLite trước/sau khớp, giữ chữ/hash/thời điểm xác minh. Các ca phiên bản cũ 0 cũng đạt. **Đóng.** |
| **R17-02 — P2** | Phản hồi thiếu dữ kiện thay chữ đang lưu bằng câu cảnh báo; UI ẩn ô và Copy sai | `comment-generator.ts:218`–261 giữ nội dung/ba phần và tách `errorMessage`; `page.tsx:1667`–1687 hiển thị cảnh báo cùng ô cũ | Hai ca độc lập phản hồi/UI đạt; Chromium xác nhận cảnh báo riêng, ba ô đủ giá trị cũ, SQLite = phản hồi = clipboard đối với nội dung tổng. Sửa ô, tải lại và Copy tiếp vẫn khớp dữ liệu. **Đóng.** |
| **R17-03 — P2** | GraphQL có thể thiếu học viên inactive nhưng vẫn thay cache | `scrape-scores.ts:293` đối chiếu tổng roster; `:528` đối chiếu từng mã ở điểm chung trước lưu cho cả GraphQL và DOM | Phản hồi chỉ có S1 active, thiếu S2 inactive: thất bại, **0 lần ghi cache**, cache SQLite hai dòng giữ nguyên. Phản hồi đủ hai học viên thành công. Các ca DOM trễ/trống/kẹt tiếp tục đạt. **Đóng.** |
| **R17-04 — P2** | Xung đột Quick Tags hiển thị PRESENT thay thẻ thật | `page.tsx:811`–846 đọc `quickTagsJson`, chọn đúng trường bị xung đột | Ca độc lập đạt. Chromium: tab A lưu “Hăng hái phát biểu”; tab B giữ “Tập trung cao độ” chưa lưu; cảnh báo chứa đúng thẻ tab A, không chứa “Bản đã lưu: PRESENT”. Tải lại lấy đúng thẻ đã lưu. **Đóng.** |

Các trường hợp ở Vòng 17 được chạy lại nguyên script lịch sử trên bản sao; không sửa tiêu chí của `round-17/verify-independent.mjs`. Mã và bằng chứng trong cây gốc Vòng 17 được bảo toàn.

### Bằng chứng giao diện trực tiếp

- [insufficient-copy.png](insufficient-copy.png): cảnh báo thiếu thông tin hiện cùng ba ô `OLD STRENGTH`, `OLD IMPROVEMENT`, `OLD PLAN`; nút Copy báo đã copy. Giá trị clipboard được kiểm bằng `navigator.clipboard.readText()`, không suy ra chỉ từ nhãn nút.
- [tag-conflict.png](tag-conflict.png): cảnh báo ghi đúng “Hăng hái phát biểu”, còn lựa chọn “Tập trung cao độ” chưa lưu vẫn sáng trên tab B. SQLite được đọc trực tiếp để xác nhận không ghi đè thẻ tab A.
- Xung đột ghi chú cũng được kiểm: dữ liệu giữ `FIRST TAB SAVED`, tab B giữ `SECOND TAB UNSAVED`, cảnh báo hiển thị bản đã lưu. HTTP có Origin bên ngoài bị trả **403**.

## 5. Hồi quy và phạm vi Giai đoạn 1–4

[issue-status.json](issue-status.json) đối chiếu **65 mã**: 49 mã lịch sử Vòng 1–12, 7 mã R15, 5 mã R16 và 4 nhóm lỗi R17. Danh mục cũ dùng để tra cứu tiêu chí; kết quả PASS của vòng này lấy từ các lệnh vừa chạy. Không còn lỗi mở đã tái hiện trong phạm vi xác minh này.

| Phần | Bằng chứng và giới hạn |
|---|---|
| Giai đoạn 1: cấu hình, lưu trữ và bảo vệ cục bộ | Hồi quy và bộ độc lập đạt về khóa dữ liệu, đường dẫn cho phép, đọc cấu hình và từ chối Host/Origin sai. Kiểm tra 14 tệp JavaScript gửi trình duyệt không thấy 4 tên biến nhạy cảm đã liệt kê trong `review-scope.json`; phép tìm tên này không chứng minh quét mọi bí mật. |
| Giai đoạn 2: trình duyệt dùng chung, hàng đợi và sự kiện | Bộ Vòng 16 đạt các ca một context dùng chung, tối đa một tác vụ đang chạy, khôi phục trang và gỡ đăng ký sự kiện khi đóng/hủy. Chưa thử nhiều tiến trình server cùng dùng một hồ sơ đăng nhập thật. |
| Giai đoạn 3: nhận xét, duyệt, phiên bản, lưu và Zalo | Các ca cũ và bốn bản sửa đạt; có kiểm bản duyệt, thay đổi lúc chờ AI, điều kiện trước Save và chặn VERIFIED sau nội dung thay đổi. Ghi LMS dùng mô phỏng; Copy và xung đột nội bộ chạy với ứng dụng thật/dữ liệu giả. Không gửi tin nhắn cho người khác. |
| Giai đoạn 4: bảng điểm và xuất báo cáo | Kiểm phân trang chậm/trống/kẹt, active/inactive, giữ cache khi thiếu dữ liệu, mã học viên, điểm 0, trạng thái bài nộp và an toàn định dạng bảng tính đều đạt trong các ca đã có. Chưa đối chiếu bảng điểm của lớp thật trên LMS. |

Các mã R16-02/R16-03/R16-04 và phạm vi liên quan R15-02/R15-03/R15-05 nay đạt cả ca gốc lẫn các biến thể R17 trước đây còn mở. Không dùng build xanh để thay thế bằng chứng chức năng.

## 6. Kết luận và bước tiếp theo

**Đã làm:** Chạy đủ 7 lệnh yêu cầu trên bản sao, chạy smoke giao diện thật với dữ liệu giả, đóng bốn nhóm R17, đối chiếu 65 mã và lập hồ sơ SHA-256. Đã cập nhật mục AUDIT-R18 trong kế hoạch.

**Kết quả:** **GO cấp mã nguồn để chuyển sang triển khai Giai đoạn 5** đối với nguồn đã chụp. Hồi quy đạt, 186/186 nhóm độc lập đạt, smoke cuối đạt, build 18/18 trang. Mã sản phẩm và 149 tệp được bảo vệ không thay đổi trong cây gốc.

**Chưa kiểm tra:** Đăng nhập/đồng bộ/ghi Teaching và LMS thật; lời gọi và chất lượng phản hồi Gemini thật; khả năng chịu tải nhiều máy/tiến trình; kiểm tra xâm nhập hệ điều hành hoặc tra cứu lỗ hổng thư viện trực tuyến. Các bộ đọc bài, chấm bài và upload thuộc Giai đoạn 5–7 chưa được nghiệm thu trong vòng này. Không khẳng định toàn hệ thống không còn mọi lỗi hoặc đạt nghiệm thu dữ liệu thật.

**Việc tiếp theo:** Có thể giao triển khai Giai đoạn 5 theo kế hoạch, giữ các kiểm tra hồi quy làm điều kiện kiểm chứng sau thay đổi. Owner chưa cần đăng nhập hay thao tác kỹ thuật cho việc hoàn tất Vòng 18.
