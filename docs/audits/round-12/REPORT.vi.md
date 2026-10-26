# Báo cáo kiểm toán độc lập Vòng 12 — MINDX Automation Bot

Ngày kiểm tra: **20/10/2026**, giờ Việt Nam. Phạm vi: mã nguồn đang có trên máy, gồm cả thay đổi chưa commit, chuẩn bị chuyển sang Giai đoạn 5.

**Kết luận: NO-GO ở cấp mã nguồn cho Giai đoạn 5.** Bản vá `R11-01` đạt. Các tình huống hồi quy Vòng 1–11 tìm thấy trong dự án đều đạt, nhưng kiểm chứng độc lập phát hiện **`R12-01` — P2: yêu cầu lưu ghi chú cũ thành công muộn có thể ghi đè lần sửa mới đã lưu thành công**. Giáo viên chỉ thấy nội dung bị mất sau khi tải lại trang.

Ứng dụng được đánh giá theo cách dùng một giáo viên, chạy trên máy cá nhân. Ngay cả ở mức dùng này, việc nhập liên tiếp nhiều ký tự có thể phát sinh nhiều yêu cầu lưu cùng một học viên.

## 1. Phạm vi và độ tin cậy của bằng chứng

- HEAD nền: `2570d96b6770957e218031c91f14ce98e766dfa7`. HEAD này **không đại diện đủ cho nội dung được kiểm tra**, vì mã đang có nhiều thay đổi chưa commit và một số file mới chưa được Git quản lý. Danh sách file và SHA-256 của từng file nằm trong [source-state.json](source-state.json).
- Đã đọc trực tiếp kế hoạch, mã giao diện nhận xét/bảng điểm, các đường nhận yêu cầu lưu/duyệt/tạo AI, mã đồng bộ lớp, đọc điểm, lưu nhận xét LMS, bộ lọc phản hồi mạng, SQLite, xuất bảng điểm, cấu hình JSON, giới hạn đường dẫn và các file test liên quan. Đã đối chiếu cấu hình máy cục bộ, trình duyệt dùng chung và hàng đợi thao tác LMS.
- Không tìm thấy báo cáo gốc riêng biệt của Vòng 1–11 trong checkout. Ý nghĩa các mã lịch sử được đối chiếu từ `scripts/test-phase4-codex-repros.ts`, đặc biệt bảng `R2-01…R2-11 ↔ A01…A14` tại dòng **2009–2022**, và bối cảnh `R11-01` do Owner cung cấp. Các nhãn mô tả dưới đây là diễn giải các tiêu chí kiểm tra còn lưu trong mã; không phải xác nhận rằng hồ sơ gốc không còn tiêu chí khác.
- “Đạt” trong các bảng nghĩa là **đạt tình huống sửa lỗi cụ thể ở cấp mã nguồn**, bằng đọc mã và thực thi kiểm tra. Không đồng nghĩa với không còn mọi lỗi trong chức năng đó.
- Bộ kiểm chứng mới không gọi lại hoặc sao chép các assertion từ bộ test của người sửa. Nó đọc mã sản phẩm hiện tại và chạy các hàm thực tế trong môi trường kiểm tra riêng. SQLite chạy thật ở chế độ `:memory:`; phản hồi mạng, đối tượng thao tác LMS và lịch cập nhật giao diện được mô phỏng. Phần JSX trình bày giao diện được bỏ khỏi môi trường thử, các hàm xử lý được giữ nguyên. Đây không phải thử nghiệm giao diện trên trình duyệt thật hay kiểm chứng cách React xử lý mọi tình huống đồng thời.
- Không đăng nhập hoặc thao tác tài khoản LMS/Teaching thật; không gọi Gemini thật; không ghi dữ liệu học viên vào cơ sở dữ liệu ứng dụng. Không sửa mã sản phẩm, file test có sẵn hoặc đánh dấu hoàn thành thêm trong kế hoạch.

## 2. Các lệnh đã thực thi

Thư mục chạy: `F:\MINDX_project test\MINDX-AUTOMATION`. Node: `v24.21.0`; bản dựng báo Next.js `16.4.2`.

| Lệnh | Kết quả thực tế | Bằng chứng |
|---|---|---|
| `npx tsx scripts/test-phase4-codex-repros.ts` | **Đạt**, mã thoát `0`; chạy hết các nhóm được gắn nhãn Vòng 1–11 | [regressions.log](regressions.log) |
| `npx tsc --noEmit --incremental false` | **Đạt**, mã thoát `0`, không báo lỗi TypeScript | [commands.json](commands.json); [typecheck.log](typecheck.log) rỗng vì không có lỗi |
| `npm run build` | **Đạt**, lần chạy trực tiếp cuối cùng mã thoát `0`; biên dịch, kiểm tra kiểu và tạo đủ 18 trang | [build.log](build.log) |
| `node docs/audits/round-12/verify-independent.mjs` | **Chưa đạt**, mã thoát `1`: **42 nhóm đạt, 1 nhóm lỗi** (`R12-01`) | [independent.log](independent.log), [independent-results.json](independent-results.json) |

Trong quá trình lưu nhật ký, một lần dựng lại dừng với `spawn EPERM` tại bước tạo tiến trình kiểm tra TypeScript. Đã giữ [build-capture-eperm.log](build-capture-eperm.log), chạy lại trực tiếp không sửa mã và hoàn tất thành công. Không bỏ qua hoặc đổi mã thoát của lần lỗi. Lần khởi động bộ kiểm chứng mới qua esbuild cũng bị chặn tạo tiến trình; bộ kiểm chứng cuối dùng bộ chuyển đổi TypeScript có sẵn trong Node và không còn phụ thuộc cách chạy đó.

`next-env.d.ts` bị Next.js thay đổi khi dựng; đã khôi phục **đúng từng byte** về bản chụp trước khi chạy. Các dòng `ExperimentalWarning`, `NativeCommandError` do PowerShell biểu diễn đầu ra cảnh báo và các lỗi mạng được cố ý tạo trong test không được dùng thay cho mã thoát để kết luận.

## 3. Quy ước đọc bảng bằng chứng

Các tên ngắn dưới đây tương ứng với file thật. Số sau dấu `:` là **dòng mã**, khoảng số là phần đã đọc và đối chiếu.

| Tên ngắn | File |
|---|---|
| SC | [src/app/session-comments/page.tsx](../../../src/app/session-comments/page.tsx) |
| CS | [src/lib/playwright/save-comments.ts](../../../src/lib/playwright/save-comments.ts) |
| SS | [src/lib/playwright/scrape-scores.ts](../../../src/lib/playwright/scrape-scores.ts) |
| SY | [src/lib/playwright/sync-class.ts](../../../src/lib/playwright/sync-class.ts) |
| DB | [src/lib/db/sqlite.ts](../../../src/lib/db/sqlite.ts) |
| SD | [src/app/api/session-comments/save-draft/route.ts](../../../src/app/api/session-comments/save-draft/route.ts) |
| AP | [src/app/api/session-comments/approve/route.ts](../../../src/app/api/session-comments/approve/route.ts) |
| AI | [src/lib/gemini/comment-generator.ts](../../../src/lib/gemini/comment-generator.ts) |
| NI | [src/lib/playwright/network-interceptor.ts](../../../src/lib/playwright/network-interceptor.ts) |
| HG | [src/app/homework-grader/page.tsx](../../../src/app/homework-grader/page.tsx) |
| EX | [src/app/api/homework-grader/export/route.ts](../../../src/app/api/homework-grader/export/route.ts) |
| JC | [src/lib/db/json-config.ts](../../../src/lib/db/json-config.ts) |
| ZA | [src/lib/zalo/broadcast-generator.ts](../../../src/lib/zalo/broadcast-generator.ts) |
| T | [scripts/test-phase4-codex-repros.ts](../../../scripts/test-phase4-codex-repros.ts), đã chạy trực tiếp thành công |
| I | [verify-independent.mjs](verify-independent.mjs), bộ kiểm chứng độc lập; số sau `I:` là dòng bắt đầu nhóm kiểm tra, kết quả trong JSON/log |

## 4. Bảng trạng thái từng mục Vòng 1–11

### Vòng 1 — `#1…#14`

| Mã | Tiêu chí kiểm chứng | Trạng thái | Dòng mã và kết quả test |
|---|---|---|---|
| #1 | Đọc lại toàn bộ nhận xét, không chấp nhận chỉ khớp đoạn đầu | **Đạt** | CS:593–617,629–633; T:359–365; I:117 PASS với nội dung khác đuôi/thêm nội dung |
| #2 | Phải có phản hồi đúng nghiệp vụ thành công, không chỉ dựa vào chữ hiện trên màn hình | **Đạt** | CS:443–581,629–633; NI:89–164; T:367–373; I:117,144 PASS với HTTP 500/lỗi GraphQL |
| #3 | Khóa đúng lớp/buổi/học viên, không ghép nhầm người hoặc nhầm lớp | **Đạt** | CS:49–84,298–338; SS:155–165,309–349; T:375–385; I:117,158 PASS |
| #4 | Đồng bộ lớp không được phá dữ liệu khi đọc thiếu; đọc đủ phân trang | **Đạt** | SY:124–145,307–426; T:481–536; I:179 PASS: hai trang, đổi thứ tự, dữ liệu rỗng không mở ghi DB |
| #5 | Sửa nhận xét trong lúc lưu LMS không bị đánh dấu đã xác minh cho bản mới | **Đạt** | CS:238–282,636–658,684–701; T:387–394; I:117 PASS, giữ DRAFT |
| #6 | Nội dung nhận xét có thẻ HTML được điền như chữ, không chạy mã HTML | **Đạt** | CS:406–431; HG:91–105; T:539–564; I:125 PASS với thẻ ảnh có sự kiện giả lập |
| #7 | Học viên trùng tên vẫn giữ mã riêng; dữ liệu lạ không ghi đè bộ điểm đã lưu | **Đạt** | SS:300–349; DB:765–899; T:167–237; I:158,190 PASS |
| #8 | Phân biệt điểm 0, chưa chấm, chưa nộp, làm lại; không tự biến thiếu điểm thành 0 | **Đạt** | SS:845–985; T:35–61,198–237; I:166 PASS |
| #9 | Chặn chuỗi bị bảng tính hiểu thành công thức và ký tự làm lệch hàng/cột | **Đạt** | EX:9–15,109–113; HG:83–89,319–336; T:539–564; I:224 PASS |
| #10 | Không hiển thị/xuất bảng điểm cũ khi đổi lớp hoặc đang đọc dữ liệu mới | **Đạt** | HG:134–193,197–280; T:1482–1517; I:240 PASS, hai cờ chờ tải đều được tắt |
| #11 | Điểm Quiz tách khỏi thực hành; cách xuất điểm/trạng thái nhất quán | **Đạt** | SS:452,486 và 852–892; EX:18–59; HG:283–307; T:167–197,547–564; I:158,166,224 PASS |
| #12 | Không tự tạo 14 buổi khi LMS đọc lỗi; mẫu Zalo theo khóa, không gán lịch mặc định không có căn cứ | **Đạt** | SY:281–282; ZA:43–65,131–143; T:481–489,570–583; I:179,231 PASS |
| #13 | Chỉ tạo nhận xét cho học viên đang học, có mặt/đi muộn; thiếu thông tin không để AI tự viết | **Đạt** | AI:81–140; T:585–621; I:212 PASS: người không thuộc lớp bị loại, thiếu thông tin không gọi AI |
| #14 | Đọc kho cấu hình phải qua kiểm tra thư mục cho phép | **Đạt** | JC:7–37; `src/lib/security/path-allowlist.ts`:15–86; T:624–630; I:231 PASS với đường dẫn bị cấm |

### Vòng 2 — `R2-01…R2-11` và các ca `A01…A14`

| Mã | Ca tương ứng / tiêu chí | Trạng thái | Dòng mã và kết quả test |
|---|---|---|---|
| R2-01 | A01: đọc lại phải bằng toàn bộ nội dung đã duyệt | **Đạt** | CS:593–617; T:638–653; I:117 PASS |
| R2-02 | A09: nhận đúng thao tác và định danh trong phản hồi mạng | **Đạt** | NI:89–164; CS:450–565; T:1228–1385; I:133,144 PASS |
| R2-03 | A02: tên ngắn không được khớp một phần tên dài | **Đạt** | CS:322–338; T:655–735; I:152 PASS |
| R2-04 | A11: mã tạm của học viên ổn định khi thứ tự danh sách đổi | **Đạt** | SY:356–374; DB:248–260; T:1676–1716; I:179 PASS |
| R2-05 | A03/A05: mã lớp nội bộ chưa xác thực, sai danh sách hoặc trùng tên mơ hồ phải bị chặn | **Đạt** | SS:155–165,293–349; T:737–799; I:158 PASS, không ghi cache |
| R2-06 | A04/A06: thiếu mảng bài nộp hoặc ma trận điểm không hợp lệ phải bị từ chối | **Đạt** | SS:273–276; DB:765–899; T:754–766,801–865; I:158,190 PASS |
| R2-07 | A12: phát hiện phân trang kẹt/trùng, không chấp nhận danh sách bị cắt ở giới hạn | **Đạt** | SS:696–743,798–832; T:1718–1722,1945–2005; I:172 PASS |
| R2-08 | A10: đổi lớp/đọc điểm không để trạng thái chờ bị treo | **Đạt** | HG:134–154,197–259; T:1482–1517; I:240 PASS |
| R2-09 | A07/A08: lưu/duyệt/AI có kiểm tra lớp, người học và điểm danh; không tự mặc định có mặt | **Đạt** | SD:36–69,105–122; AP:36–64,83–120; AI:81–103; T:883–1201; I:202,212 PASS |
| R2-10 | A12/A14: Quiz và thực hành riêng; Quiz đã chấm mà thiếu điểm phải báo lỗi | **Đạt** | SS:428,452,852–892; T:1718–1739; I:158,166 PASS |
| R2-11 | A13: AI bỏ sót/thiếu nội dung phải FAILED, không sinh nhận xét thay thế | **Đạt** | AI:321–337; SC:935–941; T:1203–1226,1519–1585; I:212,255 PASS |

Toàn bộ A01…A14 được bao phủ trong bảng: A01→R2-01; A02→R2-03; A03/A05→R2-05; A04/A06→R2-06; A07/A08→R2-09; A09→R2-02; A10→R2-08; A11→R2-04; A12→R2-07/R2-10; A13→R2-11; A14→R2-10.

### Vòng 3 — `R3-01…R3-07`

| Mã | Tiêu chí kiểm chứng | Trạng thái | Dòng mã và kết quả test |
|---|---|---|---|
| R3-01 | Nội dung thừa cùng dòng, xuống dòng hoặc tab đều không được VERIFIED | **Đạt** | CS:610–617; T:638–653; I:117 PASS |
| R3-02 | Yêu cầu mạng rỗng/sai buổi bị từ chối | **Đạt** | CS:451–565; T:1271–1385; I:133 PASS |
| R3-03 | Cùng số lượng nhưng sai danh sách hoặc trùng tên không có mã chính xác phải bị từ chối | **Đạt** | SS:293–349; T:768–799; I:158 PASS |
| R3-04 | Trạng thái/điểm/cột của ô điểm sai phải bị chặn | **Đạt** | DB:829–899; T:845–865; I:190 PASS với null, NaN, ngoài thang điểm, sai cột |
| R3-05 | Không tra học viên toàn hệ thống khi thiếu lớp; AI thiếu định danh không được chạy | **Đạt** | DB:290–299; AI:47–72; T:867–878,1192–1201; I:190,212 PASS |
| R3-06 | AI lỗi và lưu ghi chú riêng không xóa nội dung nhận xét đã có | **Đạt** | SC:667–695,935–941; SD:105–122; T:883–932,1519–1585; I:202,255 PASS |
| R3-07 | Ẩn tên học viên trong ghi chú/thẻ trước khi gửi AI | **Đạt** | AI:150–250; T:1203–1226; I:212 PASS, payload không chứa tên mẫu và có STUDENT_01 |

### Vòng 4 — `R4-01…R4-06`

| Mã | Tiêu chí kiểm chứng | Trạng thái | Dòng mã và kết quả test |
|---|---|---|---|
| R4-01 | Danh sách lớp A đến muộn không được thay lớp B | **Đạt** | SC:134–175,202–243; T:1587–1646; I:243 PASS |
| R4-02 | Định danh mâu thuẫn hoặc payload chỉ chứa nhận xét phải bị chặn | **Đạt** | CS:485–562; T:1741–1847; I:133 PASS |
| R4-03 | Đọc điểm lỗi trong khi đang tải bản lưu phải tắt cả hai trạng thái chờ | **Đạt** | HG:197–203,250–259; T:1648–1673; I:240 PASS |
| R4-04 | Thiếu columnId, maxScore hoặc score phải bị từ chối | **Đạt** | DB:836–855; T:1850–1897; I:190 PASS |
| R4-05 | Gọi thẳng bộ sinh AI với buổi khác lớp cũng phải bị chặn | **Đạt** | AI:47–72; T:1900–1942; I:212 PASS, chưa gọi mô hình |
| R4-06 | Sau 50 trang vẫn còn nút tiếp phải báo chưa đọc đủ | **Đạt** | SS:694–696,818–821; T:1945–2005; I:172 PASS |

### Vòng 5 — `R5-01…R5-04`

| Mã | Tiêu chí kiểm chứng | Trạng thái | Dòng mã và kết quả test |
|---|---|---|---|
| R5-01 | Đổi buổi cùng lớp phải xóa dòng cũ và chặn lưu/duyệt sai buổi | **Đạt** | SC:134–157,601–618,991–1002; T:2119–2176; I:243 PASS, buổi mới còn đang tải thì không phát lệnh lưu cho dòng cũ |
| R5-02 | Phản hồi duyệt bản cũ không được đánh dấu bản vừa sửa là APPROVED | **Đạt** | SC:1004–1044; T:2179–2231; I:252 PASS |
| R5-03 | Các trường định danh/nội dung được giám sát có null phải bị chặn ở mọi tầng payload | **Đạt** | CS:485–553; T:2927–3048; I:133 PASS, kiểm tra 15 tên trường × 3 vị trí, gồm cả feedback |
| R5-04 | Đổi lớp rồi đọc điểm lỗi ngay không sinh thêm GET khiến chờ vô hạn | **Đạt** | HG:131,147–150,204–207,250–259; T:2234–2265; I:240 PASS, chỉ một GET khởi đầu |

### Vòng 6–11

| Vòng / mã | Tiêu chí kiểm chứng | Trạng thái | Dòng mã và kết quả test |
|---|---|---|---|
| 6 / R6-01 | Đường lưu/duyệt kiểm tra người học thuộc lớp và đang học; duyệt chỉ khi PRESENT/LATE | **Đạt** | SD:56–69; AP:56–64,83–120; T:934–1138; I:202 PASS với DB thật trong bộ nhớ, người không tồn tại/sai lớp/nghỉ học và các trạng thái điểm danh |
| 7 / R7-01 | Sửa ghi chú/thẻ/điểm danh từ DRAFT, APPROVED, VERIFIED phải lưu DRAFT và giữ đúng sau tải lại | **Đạt** | SC:435–545,637–695; T:2267–2423; I:264 PASS đủ 9 tổ hợp |
| 8 / R8-01 | Xác nhận có mặt hàng loạt có người lưu lỗi không được báo tất cả thành công; khôi phục dòng lỗi | **Đạt** | SC:621–635,704–744,764–860; T:2432–2528; I:261 PASS đủ HTTP 400,500,lỗi mạng,người vừa nghỉ học; S2 thành công được giữ |
| 9 / R9-01 | Phản hồi lưu lỗi cũ không đè chỉnh sửa mới hoặc dòng của lớp mới | **Đạt** | SC:627–635,709–737; T:2531–2675; I:258,267 PASS. Kết luận này áp dụng nhánh phản hồi **lỗi**; xem R12-01 cho yêu cầu cũ **thành công** |
| 10 / R10-01 | Đối chiếu lại sau lỗi điểm danh hàng loạt không được xóa ghi chú mới đang chờ lưu | **Đạt** | SC:785–795,830–845; T:2677–2780; I:267 PASS cả HTTP 500 và lỗi mạng, ghi chú mới còn đang chờ |
| 11 / R11-01 | Khi S1 chờ mạng, việc lưu điểm danh S2 tiếp theo không được gửi nội dung cũ làm mất chỉnh sửa mới của S2 | **Đạt** | SC:91–100,612–635,667–695,752–789; T:2783–2921 PASS đủ 4 chế độ; I:272–280 PASS **16 tổ hợp** = 4 chế độ × 4 loại chỉnh sửa |

Tổng cộng **48 mã lỗi lịch sử** được liệt kê riêng: 14 + 11 + 7 + 6 + 4 + 6. Các A01…A14 là nhóm ca kiểm thử tương ứng của Vòng 2, không cộng thêm thành lỗi mới.

## 5. Kiểm chứng riêng bản vá R11-01

Phần đồng bộ tức thời nằm tại SC:94–100: tính danh sách mới từ `studentsRef.current`, gán lại ref rồi cập nhật dữ liệu giao diện. Các hàm sửa ghi chú/thẻ/điểm danh/nội dung đọc ref tại SC:439,481,515,557; hàm lưu đọc ref tại SC:612. Các hàm AI/duyệt/duyệt cả lớp đọc ref tại SC:870,997,1060.

Lệnh lưu hàng loạt chỉ gửi `{ attendanceStatus: "PRESENT", status: "DRAFT" }` cho học viên tiếp theo (SC:785–789). Payload được tạo riêng từng trường (SC:667–695); ca điểm danh không kèm ghi chú/thẻ/nội dung nhận xét cũ. Bộ test độc lập đối chiếu cả **danh sách khóa của payload**, không chỉ kết quả nhìn thấy sau cùng.

| Chế độ S1 | Ghi chú mới S2 | Thẻ mới S2 | Nội dung mới S2 | S2 tự đổi điểm danh |
|---|---|---|---|---|
| control: không chỉnh sửa xen giữa | Đạt, giữ bản cũ hợp lệ | Đạt | Đạt | Đạt |
| first-success: S1 lưu thành công chậm | Đạt | Đạt | Đạt | Đạt, giữ LATE |
| first-http-error: S1 trả HTTP 500 | Đạt | Đạt | Đạt | Đạt, giữ LATE |
| first-network-error: S1 lỗi kết nối | Đạt | Đạt | Đạt | Đạt, giữ LATE |

Đã kiểm tra SQLite, dữ liệu giao diện và tải lại qua đường đọc dữ liệu. Với control, bốn nhánh không tạo chỉnh sửa xen giữa, nên xác nhận đường cơ sở không làm thay đổi dữ liệu cũ ngoài điểm danh có chủ đích. Phần đếm phiên bản điểm danh tại SC:778–783 giúp lượt hàng loạt bỏ qua thay đổi điểm danh riêng mới hơn; đối chiếu lỗi chỉ ghép thông tin điểm danh/trạng thái và có kiểm tra phiên bản tại SC:835–845.

## 6. Lỗi mới phải sửa trước khi GO

### R12-01 — P2 — Yêu cầu lưu ghi chú cũ đến sau làm mất ghi chú mới đã lưu

**Nguyên nhân:** Mỗi lần thay đổi ghi chú gửi ngay một yêu cầu lưu riêng. Không có hàng đợi theo học viên hoặc điều kiện phiên bản khi ghi dữ liệu. Bộ đếm `studentEditVersionRef` chỉ dùng để tránh xử lý phản hồi **lỗi** đã cũ trên giao diện; nó không làm phía nhận yêu cầu từ chối nội dung cũ.

**Vị trí:**

- SC:478–503: sửa ghi chú và phát yêu cầu tự lưu ngay.
- SC:627–635: phiên bản được giữ ở phía giao diện, không đưa vào payload tại SC:667–695.
- SC:698–726: các yêu cầu `fetch` được phát độc lập; nhánh thành công trả `true`.
- SD:105–122: đọc bản đang lưu rồi ghi các trường nhận được, không kiểm tra yêu cầu có cũ hơn lần sửa đã lưu hay không.
- DB:362–374: khi trùng bộ khóa lớp/buổi/học viên thì cập nhật bằng dữ liệu của yêu cầu đang chạy.

**Cách tái hiện đã chạy:**

1. Tải học viên giả S1; giáo viên sửa ghi chú thành `older edit`.
2. Giữ yêu cầu này trước khi nó tới hàm nhận lưu.
3. Giáo viên sửa tiếp thành `LATEST EDIT`; cho yêu cầu mới chạy hết qua đường lưu thật và SQLite trong bộ nhớ. DB lúc này chứa `LATEST EDIT`.
4. Thả yêu cầu cũ. Cả hai lần lưu đều nhận **HTTP 200**.
5. DB bị đổi ngược về `older edit`; giao diện còn `LATEST EDIT` vì không có lỗi nào để báo.
6. Tải lại qua đường đọc dữ liệu thật: giao diện đổi về `older edit`.

Kết quả ghi lại trực tiếp:

```json
{"statuses":[200,200],"visible":"LATEST EDIT","stored":"older edit","reloaded":"older edit"}
```

Kiểm tra tại [verify-independent.mjs:285](verify-independent.mjs) cố ý đòi DB vẫn là `LATEST EDIT`, và **thất bại**. Vì thế bộ kiểm chứng trả mã `1`; không đánh dấu lỗi này là PASS chỉ vì đã tái hiện được. Đây là bằng chứng thực thi mã giao diện và đường lưu/đọc với SQLite thật trong bộ nhớ, dưới thứ tự đến của yêu cầu được chủ động điều khiển; chưa phải tái hiện qua mạng/browser thật.

**Ảnh hưởng:** Nội dung giáo viên vừa nhập có thể mất mà không có thông báo lưu thất bại. Lỗi không cần đổi lớp hoặc chạy nhiều người cùng lúc; hai lần tự lưu trên cùng học viên là đủ. R11-01 đã chặn việc lệnh điểm danh gửi kèm ghi chú cũ, nhưng chưa giải quyết hai yêu cầu trực tiếp sửa cùng trường này.

**Cách sửa nhỏ nhất đề xuất:** Tuần tự hóa các yêu cầu lưu nháp theo cùng bộ `classId/sessionId/studentId`, để lần sửa trước hoàn tất trước khi gửi lần sửa sau. Giữ payload chỉ gồm các trường thay đổi, cơ chế bảo vệ lớp/buổi và cơ chế không phục hồi phản hồi lỗi cũ. Nếu sau này hỗ trợ nhiều cửa sổ cùng chỉnh sửa, cần thêm kiểm tra phiên bản ở phía ghi dữ liệu; hàng đợi trong một trang chỉ giải quyết phạm vi một trang đang dùng.

**Sau khi sửa:** Ca R12-01 phải trả về PASS; cả hai phản hồi thành công phải để DB/giao diện/tải lại đều là bản mới nhất. Chạy lại cả hai bộ kiểm thử, TypeScript và bản dựng; giữ nguyên các ca R7–R11. Vòng kiểm toán này chỉ đưa khuyến nghị, chưa thực hiện sửa lỗi.

Prompt có thể giao cho người sửa:

```text
Chỉ sửa R12-01 trong docs/audits/round-12/REPORT.vi.md: các yêu cầu tự lưu ghi chú
cùng lớp/buổi/học viên có thể đến sai thứ tự và ghi đè bản mới, dù đều HTTP 200.
Đọc kế hoạch và mã liên quan trước khi sửa; giữ nguyên thay đổi hiện có của Owner.
Ưu tiên hàng đợi lưu nháp theo bộ classId/sessionId/studentId cho phạm vi một trang.
Giữ payload chỉ chứa trường thay đổi, chặn sai lớp/buổi và giữ các bảo vệ R7–R11.
Bổ sung ca kiểm tra hai yêu cầu thành công đến ngược thứ tự, đối chiếu DB và tải lại.
Nếu cách sửa đổi thời điểm gửi yêu cầu, điều chỉnh môi trường giả lập của ca audit
cho đúng hàng đợi; không xóa hay giảm yêu cầu bản cuối phải giữ nội dung mới nhất.
Chạy npx tsx scripts/test-phase4-codex-repros.ts; bộ kiểm chứng độc lập;
npx tsc --noEmit --incremental false; npm run build; khôi phục next-env.d.ts nếu bị đổi.
Không sửa hoặc ghi lên LMS/Teaching thật. Báo cáo file thay đổi và bằng chứng mới.
```

## 7. Điều kiện kết thúc và giới hạn

**Đã làm:** Đọc/đối chiếu mã và test; thực thi các lệnh bắt buộc; tạo bộ kiểm chứng riêng và báo cáo 48 mục lịch sử; kiểm tra R11-01 với 16 tổ hợp; lưu nhật ký và dấu SHA-256 của mã được kiểm tra. Các file tạo thêm đều nằm trong `docs/audits/round-12/`.

**Kết quả:** R11-01 đạt; các tiêu chí lịch sử tìm thấy đạt. Bộ test dự án trả `0`; bộ độc lập có 42 nhóm đạt và 1 nhóm lỗi. **NO-GO cho Giai đoạn 5 tại thời điểm kiểm toán**, vì R12-01 gây nguy cơ mất ghi chú mới. Đây là đánh giá chuyển giai đoạn ở cấp mã nguồn, không phải đánh giá Giai đoạn 5 đã được triển khai đầy đủ.

**Chưa kiểm tra:** Không xác nhận với tài khoản thật, DOM/API LMS đang vận hành, kết quả AI thật, dữ liệu bảng điểm thực tế nhiều trang, cách trình duyệt/React xử lý mọi tình huống đồng thời, hoặc chức năng tải/chấm bài của Giai đoạn 5. Không kiểm toán lại toàn bộ thư viện bên thứ ba/CVE. Không thể xác nhận tiêu chí lịch sử nằm ngoài hồ sơ và mapping còn có trong checkout.

**Việc tiếp theo:** Sửa riêng R12-01, chạy lại kiểm chứng trên đúng bản mã sau sửa rồi quyết định GO. Owner chưa cần thao tác tài khoản hoặc chạy lệnh thủ công.
