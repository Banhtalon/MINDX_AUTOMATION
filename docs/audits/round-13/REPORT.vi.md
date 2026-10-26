# Báo cáo kiểm chứng độc lập Vòng 13 — MINDX Automation Bot

Ngày: **20/10/2026**, giờ Việt Nam. Phạm vi: xác minh lại các mã lỗi Vòng 1–12 trên mã nguồn hiện có, đặc biệt bản vá `R12-01`; đánh giá điều kiện chuyển sang Giai đoạn 5.

**Kết luận cuối cùng: NO-GO cho việc xác nhận chuyển sang Giai đoạn 5 ở cấp mã nguồn trong vòng kiểm định này.** `R12-01` **đã đạt** các tình huống kiểm chứng; các tiêu chí lịch sử tìm thấy của Vòng 1–11 cũng đạt. Tuy nhiên, bước bắt buộc `npm run build` **chưa hoàn tất**: cả ba lần chạy đều thoát `1` với `spawn EPERM`. Đây là trở ngại của môi trường thực thi, chưa có bằng chứng là lỗi mã sản phẩm. Không lấy kết quả bản dựng của Vòng 12 thay cho bằng chứng của Vòng 13 và không đổi lỗi môi trường thành PASS.

## 1. Phạm vi, nguồn và độ tin cậy

- HEAD nền: `2570d96b6770957e218031c91f14ce98e766dfa7`. Có nhiều thay đổi có sẵn chưa commit; kết quả áp dụng cho **nội dung file đang có trên máy**, không chỉ HEAD. [source-state.json](source-state.json) ghi SHA-256 của 53 file mã nguồn, test, cấu hình dự án và cấu hình dữ liệu liên quan. [git-status.before.txt](git-status.before.txt) ghi tình trạng ban đầu của Git.
- Đã đọc trực tiếp kế hoạch, báo cáo Vòng 12, bản vá giao diện/API, SQLite, mã lưu nhận xét LMS, đồng bộ lớp, đọc/xuất điểm, bộ lọc phản hồi mạng, sinh AI, Zalo, kiểm tra đường dẫn, giới hạn yêu cầu cục bộ, trình duyệt dùng chung, hàng đợi và các test liên quan. Đã đối chiếu tài liệu kiểm thử/TypeScript đi kèm đúng bản Next.js trong `node_modules/next/dist/docs/`.
- **Không tìm thấy báo cáo gốc riêng của Vòng 1–11 trong checkout.** Các mã đó được đối chiếu theo bộ test đang có và bảng ánh xạ `R2-01…R2-11 ↔ A01…A14` tại `scripts/test-phase4-codex-repros.ts:2010–2022`, cùng bảng lịch sử trong báo cáo Vòng 12. Vì vậy, “Đạt” nghĩa là đạt **tiêu chí lịch sử còn kiểm chứng được**, không xác nhận rằng từng báo cáo gốc không có thêm yêu cầu khác.
- Bộ độc lập Vòng 12 đã được **chạy lại trong phiên này**, không dùng lại kết quả cũ. Bộ Vòng 13 viết các khẳng định kiểm tra mới và dùng lại **chỉ bộ dựng dữ liệu/điều phối mô phỏng** của kiểm toán Vòng 12, không gọi bộ test của người vá và không sao chép các khẳng định kiểm tra của họ. Các hàm sản phẩm được đọc từ file hiện tại lúc chạy.
- SQLite chạy thật ở chế độ `:memory:` — cơ sở dữ liệu riêng trong bộ nhớ. Mạng, thao tác LMS và lịch cập nhật giao diện được mô phỏng có kiểm soát. Phần xử lý của trang chạy thật; phần JSX trình bày được bỏ khỏi bộ mô phỏng. Các lần “tải trang mới” trong test là tạo lại bộ xử lý trang rồi đọc từ SQLite riêng, **không phải tải lại trình duyệt thật**.
- Không đăng nhập, ghi hoặc đọc tên học viên thật từ LMS/Teaching; không gọi Gemini thật; không dùng cơ sở dữ liệu học viên của ứng dụng. Không sửa mã sản phẩm hay test có sẵn. Không thay đổi cấu hình để bỏ qua bước kiểm tra của bản dựng.

## 2. Lệnh đã chạy thật và kết quả

Thư mục: `F:\MINDX_project test\MINDX-AUTOMATION`. Node `v24.21.0`; Next.js báo `16.4.2`.

| Lệnh | Mã thoát / kết quả | Bằng chứng mới của Vòng 13 |
|---|---|---|
| `npx tsx scripts/test-phase4-codex-repros.ts` | `0` — **Đạt**, hoàn tất các nhóm gắn nhãn Vòng 1–12 | [regressions.log](regressions.log) |
| `node docs/audits/round-12/verify-independent.mjs` | `0` — **43/43 nhóm đạt**, gồm R12-01 | [round12-independent.log](round12-independent.log), [round12-independent-results.json](round12-independent-results.json) |
| `npx tsc --noEmit --incremental false` | `0` — **Đạt**, không báo lỗi kiểu dữ liệu | [typecheck.log](typecheck.log) rỗng; [commands.json](commands.json) ghi mã thoát |
| `npm run build` — lần 1, ghi ra file | `1` — **Chưa đạt bước kiểm định**, biên dịch xong rồi `spawn EPERM` khi sang kiểm tra TypeScript | [build.log](build.log) |
| `npm run build` — lần 2, xuất trực tiếp | `1` — **Chưa đạt bước kiểm định**, cùng lỗi sau biên dịch | [build-direct.log](build-direct.log) |
| `npm run build` — lần 3, phiên terminal PTY | `1` — **Chưa đạt bước kiểm định**, cùng lỗi sau biên dịch | [build-pty.log](build-pty.log) |
| `node docs/audits/round-13/verify-independent.mjs` | `0` — **89/89 nhóm đạt**, kiểm chứng mới R12-01 và giới hạn yêu cầu cục bộ | [independent.log](independent.log), [independent-results.json](independent-results.json) |

Tổng hai bộ độc lập: **132 nhóm đạt, 0 nhóm thất bại**. Đây là số nhóm, không phải số khẳng định kiểm tra bên trong hay số lỗi lịch sử. Bộ hồi quy của dự án được báo riêng, không suy ra số lượng test từ dòng thông báo “100%”. Các lỗi mạng cố ý tạo và cảnh báo `stripTypeScriptTypes` trong nhật ký không làm lệnh test thất bại; mã thoát thực tế đều được giữ trong [commands.json](commands.json).

Ngay đầu phiên, công cụ phụ chụp trạng thái cũng không tạo được tiến trình `git` từ Node (`spawnSync git EPERM`). Đã chuyển sang đọc Git trực tiếp qua PowerShell và truyền kết quả vào công cụ phụ; bước chụp trạng thái sau đó thành công. Việc này củng cố nhận định có hạn chế tạo tiến trình con trong môi trường, nhưng **không chứng minh bản dựng đã thành công**. Ba lần dựng được giữ nguyên là chưa đạt.

`next-env.d.ts` được sao lưu trước khi dựng và khôi phục đúng từng byte trong khối `finally` sau mỗi lần. Kết quả mới do lệnh Vòng 12 tạo ra được sao chép sang thư mục Vòng 13 rồi khôi phục file kết quả lịch sử. [preservation-check.json](preservation-check.json) ghi đối chiếu cuối cùng; không ghi đè báo cáo lịch sử Vòng 12.

## 3. Quy ước bằng chứng mã nguồn

Số sau tên ngắn là **dòng mã của file hiện tại**; khoảng dòng chỉ phần mã liên quan. `I12:117 PASS` nghĩa là nhóm bắt đầu tại dòng 117 trong bộ độc lập Vòng 12 đã được chạy lại và đạt; kết quả nằm trong JSON/log Vòng 13 nêu trên. `T PASS` nghĩa là đã chạy thành công bộ hồi quy hiện tại của dự án. `I13` là bộ kiểm chứng mới của vòng này.

| Tên ngắn | File |
|---|---|
| SC | [src/app/session-comments/page.tsx](../../../src/app/session-comments/page.tsx) |
| SD | [src/app/api/session-comments/save-draft/route.ts](../../../src/app/api/session-comments/save-draft/route.ts) |
| AP | [src/app/api/session-comments/approve/route.ts](../../../src/app/api/session-comments/approve/route.ts) |
| CS | [src/lib/playwright/save-comments.ts](../../../src/lib/playwright/save-comments.ts) |
| SS | [src/lib/playwright/scrape-scores.ts](../../../src/lib/playwright/scrape-scores.ts) |
| SY | [src/lib/playwright/sync-class.ts](../../../src/lib/playwright/sync-class.ts) |
| DB | [src/lib/db/sqlite.ts](../../../src/lib/db/sqlite.ts) |
| AI | [src/lib/gemini/comment-generator.ts](../../../src/lib/gemini/comment-generator.ts) |
| NI | [src/lib/playwright/network-interceptor.ts](../../../src/lib/playwright/network-interceptor.ts) |
| HG | [src/app/homework-grader/page.tsx](../../../src/app/homework-grader/page.tsx) |
| EX | [src/app/api/homework-grader/export/route.ts](../../../src/app/api/homework-grader/export/route.ts) |
| JC | [src/lib/db/json-config.ts](../../../src/lib/db/json-config.ts) |
| ZA | [src/lib/zalo/broadcast-generator.ts](../../../src/lib/zalo/broadcast-generator.ts) |
| T | [scripts/test-phase4-codex-repros.ts](../../../scripts/test-phase4-codex-repros.ts) |
| I12 | [bộ kiểm chứng Vòng 12](../round-12/verify-independent.mjs), chạy mới đạt 43/43 |
| I13 | [bộ kiểm chứng Vòng 13](verify-independent.mjs), chạy mới đạt 89/89 |

## 4. Bảng trạng thái từng mã lỗi Vòng 1–12

### Vòng 1 — #1 đến #14

| Mã | Tiêu chí còn lưu trong hồ sơ/test | Trạng thái | Dòng mã và kết quả kiểm chứng mới |
|---|---|---|---|
| #1 | Đọc lại toàn bộ nhận xét; khác đuôi/thừa nội dung phải bị từ chối | **Đạt** | CS:593–617,629–633; T PASS; I12:117 PASS |
| #2 | Chỉ xác minh sau phản hồi nghiệp vụ thành công và nội dung đọc lại đúng | **Đạt** | CS:443–581,629–633; NI:89–164; T PASS; I12:117,144 PASS với HTTP 500/lỗi GraphQL |
| #3 | Khóa đúng lớp, buổi, học viên | **Đạt** | CS:49–84,298–338; SS:155–165,309–349; T PASS; I12:117,158 PASS |
| #4 | Đồng bộ đọc đủ trang, dữ liệu rỗng không phá dữ liệu đang có | **Đạt** | SY:124–145,307–426; T PASS; I12:179 PASS |
| #5 | Sửa trong khi lưu LMS không làm bản nháp mới thành VERIFIED | **Đạt** | CS:238–282,636–658,684–701; T PASS; I12:117 PASS, giữ DRAFT |
| #6 | Thẻ HTML trong nhận xét được điền như chữ | **Đạt** | CS:406–431; HG:91–105; T PASS; I12:125 PASS, không dùng innerHTML để điền |
| #7 | Trùng tên vẫn tách mã; dữ liệu điểm lạ không ghi đè bộ điểm đã lưu | **Đạt** | SS:300–349; DB:765–899; T PASS; I12:158,190 PASS |
| #8 | Phân biệt điểm 0/chưa chấm/chưa nộp/làm lại | **Đạt** | SS:845–985; T PASS; I12:166 PASS, thiếu điểm đã chấm thì báo lỗi |
| #9 | Chặn công thức bảng tính và ký tự làm lệch hàng/cột | **Đạt** | EX:9–15,109–113; HG:83–89,319–336; T PASS; I12:224 PASS |
| #10 | Đổi lớp/đọc lại không hiển thị hoặc xuất bảng điểm cũ | **Đạt** | HG:134–193,197–280; T PASS; I12:240 PASS |
| #11 | Quiz tách khỏi thực hành; số 0 và xuất trạng thái nhất quán | **Đạt** | SS:428–486,852–892; EX:18–59; HG:283–307; T PASS; I12:158,166,224 PASS |
| #12 | Không bịa 14 buổi khi đồng bộ lỗi; Zalo theo khóa, không gán lịch học cứng | **Đạt** | SY:281–282; ZA:43–65,131–143; T PASS; I12:179,231 PASS |
| #13 | AI chỉ xử lý học viên đang học/có mặt hoặc muộn; thiếu dữ kiện không tự viết | **Đạt** | AI:81–140; T PASS; I12:212 PASS, kiểm tra không gọi mô hình khi thiếu thông tin |
| #14 | Đọc cấu hình qua giới hạn thư mục được phép | **Đạt** | JC:7–37; `src/lib/security/path-allowlist.ts`:15–86; T PASS; I12:231 PASS |

### Vòng 2 — R2-01 đến R2-11

| Mã | Ca tương ứng / tiêu chí | Trạng thái | Dòng mã và kết quả kiểm chứng mới |
|---|---|---|---|
| R2-01 | A01: đọc lại bằng toàn bộ nội dung đã duyệt | **Đạt** | CS:593–617; T PASS; I12:117 PASS |
| R2-02 | A09: đúng thao tác và định danh trong phản hồi mạng | **Đạt** | NI:89–164; CS:450–565; T PASS; I12:133,144 PASS |
| R2-03 | A02: tên ngắn không khớp một phần tên dài | **Đạt** | CS:322–338; T PASS; I12:152 PASS |
| R2-04 | A11: mã học viên ổn định khi danh sách đổi thứ tự | **Đạt** | SY:356–374; DB:248–260; T PASS; I12:179 PASS |
| R2-05 | A03/A05: chặn mã lớp chưa xác thực, sai danh sách, trùng tên mơ hồ | **Đạt** | SS:155–165,293–349; T PASS; I12:158 PASS, không ghi bộ điểm |
| R2-06 | A04/A06: thiếu danh sách bài nộp/ma trận điểm sai phải bị từ chối | **Đạt** | SS:273–276; DB:765–899; T PASS; I12:158,190 PASS |
| R2-07 | A12: phân trang trùng/kẹt/vượt giới hạn phải báo chưa đọc đủ | **Đạt** | SS:696–743,798–832; T PASS; I12:172 PASS |
| R2-08 | A10: đổi lớp/đọc điểm không để trạng thái chờ bị treo | **Đạt** | HG:134–154,197–259; T PASS; I12:240 PASS |
| R2-09 | A07/A08: lưu/duyệt/AI kiểm tra lớp, người học, điểm danh | **Đạt** | SD:30–66,145–175; AP:36–64,83–120; AI:81–103; T PASS; I12:202,212 PASS |
| R2-10 | A12/A14: Quiz riêng; Quiz đã chấm thiếu điểm phải báo lỗi | **Đạt** | SS:428–486,852–892; T PASS; I12:158,166 PASS |
| R2-11 | A13: AI thiếu học viên/nội dung phải FAILED, không tạo nhận xét thay thế | **Đạt** | AI:321–337; SC:941–949; T PASS; I12:212,255 PASS |

Đối chiếu riêng đủ A01–A14 (các ca con, không cộng thành 14 lỗi mới):

| Ca | Trạng thái | Mã lỗi / bằng chứng kiểm chứng mới |
|---|---|---|
| A01 | **Đạt** | R2-01; CS:593–617; T PASS; I12:117 PASS |
| A02 | **Đạt** | R2-03; CS:322–338; T PASS; I12:152 PASS |
| A03 | **Đạt** | R2-05; SS:155–165; T PASS; I12:158 PASS |
| A04 | **Đạt** | R2-06; SS:273–276; T PASS; I12:158 PASS |
| A05 | **Đạt** | R2-05; SS:293–349; T PASS; I12:158 PASS |
| A06 | **Đạt** | R2-06; DB:765–899; T PASS; I12:190 PASS |
| A07 | **Đạt** | R2-09; SD:30–66,145–175; AP:83–120; T PASS; I12:202 PASS |
| A08 | **Đạt** | R2-09; AI:81–140; T PASS; I12:212 PASS |
| A09 | **Đạt** | R2-02; NI:89–164; CS:450–565; T PASS; I12:133,144 PASS |
| A10 | **Đạt** | R2-08; HG:134–154,197–259; T PASS; I12:240 PASS |
| A11 | **Đạt** | R2-04; SY:356–374; T PASS; I12:179 PASS |
| A12 | **Đạt** | R2-07/R2-10; SS:696–832,852–892; T PASS; I12:166,172 PASS |
| A13 | **Đạt** | R2-11; AI:321–337; SC:941–949; T PASS; I12:212,255 PASS |
| A14 | **Đạt** | R2-10; SS:852–892; T PASS; I12:158,166 PASS |

### Vòng 3 — R3-01 đến R3-07

| Mã | Tiêu chí | Trạng thái | Dòng mã và kết quả kiểm chứng mới |
|---|---|---|---|
| R3-01 | Thừa nội dung cùng dòng/xuống dòng/tab không được VERIFIED | **Đạt** | CS:610–617; T PASS; I12:117 PASS |
| R3-02 | Yêu cầu mạng rỗng/sai buổi bị từ chối | **Đạt** | CS:451–565; T PASS; I12:133 PASS |
| R3-03 | Cùng số lượng nhưng sai danh sách hoặc trùng tên thiếu mã chính xác bị chặn | **Đạt** | SS:293–349; T PASS; I12:158 PASS |
| R3-04 | Trạng thái, điểm, mã cột không hợp lệ bị chặn | **Đạt** | DB:829–899; T PASS; I12:190 PASS với null, NaN, ngoài thang điểm, sai cột |
| R3-05 | Không tra học viên ngoài phạm vi lớp; AI thiếu định danh không chạy | **Đạt** | DB:290–299; AI:47–72; T PASS; I12:190,212 PASS |
| R3-06 | AI lỗi/lưu ghi chú riêng không xóa nhận xét đang có | **Đạt** | SC:673–694,941–949; SD:145–175; T PASS; I12:202,255 PASS |
| R3-07 | Ẩn tên học viên trong ghi chú/thẻ trước khi gọi AI | **Đạt** | AI:150–250; T PASS; I12:212 PASS với tên giả lập, payload có STUDENT_01 |

### Vòng 4 — R4-01 đến R4-06

| Mã | Tiêu chí | Trạng thái | Dòng mã và kết quả kiểm chứng mới |
|---|---|---|---|
| R4-01 | Danh sách lớp A đến muộn không được thay lớp B | **Đạt** | SC:140–175,180–246; T PASS; I12:243 PASS |
| R4-02 | Định danh mâu thuẫn hoặc chỉ có nội dung nhận xét bị chặn | **Đạt** | CS:485–562; T PASS; I12:133 PASS |
| R4-03 | Đọc điểm lỗi khi đang tải bản lưu phải tắt cả hai trạng thái chờ | **Đạt** | HG:197–203,250–259; T PASS; I12:240 PASS |
| R4-04 | Ô điểm thiếu columnId/maxScore/score bị từ chối | **Đạt** | DB:836–855; T PASS; I12:190 PASS |
| R4-05 | Gọi trực tiếp bộ sinh AI với buổi khác lớp cũng bị chặn | **Đạt** | AI:47–72; T PASS; I12:212 PASS, chưa gọi mô hình |
| R4-06 | Hết 50 trang mà vẫn còn trang tiếp theo phải báo lỗi | **Đạt** | SS:694–696,818–821; T PASS; I12:172 PASS |

### Vòng 5 — R5-01 đến R5-04

| Mã | Tiêu chí | Trạng thái | Dòng mã và kết quả kiểm chứng mới |
|---|---|---|---|
| R5-01 | Đổi buổi cùng lớp phải bỏ dòng cũ, chặn lưu/duyệt sai buổi | **Đạt** | SC:140–162,592–614,986–1010; T PASS; I12:243 PASS |
| R5-02 | Phản hồi duyệt bản cũ không được duyệt bản vừa sửa | **Đạt** | SC:1013–1056; T PASS; I12:252 PASS |
| R5-03 | Trường định danh/nội dung null bị chặn ở mọi tầng yêu cầu | **Đạt** | CS:485–553; T:3019–3140 PASS; I12:133 PASS với 15 trường × 3 vị trí |
| R5-04 | Đổi lớp rồi đọc điểm lỗi ngay không tạo GET thừa gây chờ vô hạn | **Đạt** | HG:131,147–150,204–207,250–259; T PASS; I12:240 PASS, chỉ một GET khởi đầu |

### Vòng 6 đến Vòng 12

| Vòng / mã | Tiêu chí | Trạng thái | Dòng mã và kết quả kiểm chứng mới |
|---|---|---|---|
| 6 / R6-01 | Người học phải thuộc lớp/đang học; chỉ PRESENT/LATE được duyệt | **Đạt** | SD:49–66; AP:56–64,83–120; T PASS; I12:202 PASS, SQLite trong bộ nhớ |
| 7 / R7-01 | Sửa ghi chú/thẻ/điểm danh từ DRAFT/APPROVED/VERIFIED phải lưu DRAFT qua tải lại | **Đạt** | SC:439–547,637–694; T PASS; I12:264 PASS đủ 9 tổ hợp; I13:40 PASS mở rộng |
| 8 / R8-01 | Điểm danh cả lớp có lỗi không báo tất cả thành công; giữ dòng thành công | **Đạt** | SC:630–635,715–750,754–869; T PASS; I12:261 PASS với 400/500/lỗi mạng/học viên nghỉ |
| 9 / R9-01 | Phản hồi lưu lỗi cũ không khôi phục đè chỉnh sửa mới hoặc dòng của lớp khác | **Đạt** | SC:630–635,715–750; T PASS; I12:258,267 PASS |
| 10 / R10-01 | Đối chiếu sau lỗi điểm danh cả lớp không xóa ghi chú mới đang chờ lưu | **Đạt** | SC:791–801,830–845; T PASS; I12:267 PASS với HTTP 500/lỗi mạng |
| 11 / R11-01 | Khi S1 chờ lưu, điểm danh S2 không mang dữ liệu cũ làm mất chỉnh sửa mới của S2 | **Đạt** | SC:91–100,612–635,673–694,754–795; T PASS; I12:272–280 PASS đủ 16 tổ hợp |
| 12 / R12-01 | Yêu cầu lưu cũ thành công đến muộn không ghi đè bản mới đã lưu thành công | **Đạt** | SC:131–135,627–635,698–707; SD:89–175; T:2923–3011 PASS; I12:285 PASS; I13:40–183 PASS chi tiết dưới đây |

Tổng **49 mã lỗi lịch sử**: 14 + 11 + 7 + 6 + 4 + 7. Không có mã lịch sử nào bị quan sát tái xuất hiện trong các tiêu chí đã chạy. Điều này không thay thế bước dựng đang bị chặn và không phải chứng nhận không còn mọi lỗi trong ứng dụng.

## 5. Kiểm chứng trọng tâm R12-01

### Đối chiếu bản vá thực tế

1. **Phiên bản toàn trang:** SC:131–135 tạo `editSequenceRef` và mã riêng của trang `clientInstanceIdRef`. Các lần sửa dùng cùng bộ đếm (SC:440,481,512,555); mỗi lần gửi lưu tăng tiếp tại SC:627. Khi đổi lớp/buổi, các bản ghi theo học viên được xóa nhưng bộ đếm toàn trang không bị đặt về 0. I13:158 kiểm tra rời buổi, quay lại và giải phóng yêu cầu cũ.
2. **Thông tin thứ tự ngoài JSON:** SC:698–707 gửi `cid/rev` trong URL và hai header tương ứng. I13:40 kiểm tra các giá trị header/URL đồng nhất, cùng mã trang và phiên bản tăng; JSON không cần thêm trường phiên bản. I13:112 kiểm tra riêng đường chỉ dùng header bằng `Request` thật.
3. **Lọc riêng từng trường:** SD:89–107 lấy metadata, đặt khóa theo mã trang/lớp/buổi/học viên. SD:111–133 so sánh phiên bản của từng trường. Vì từ lúc lấy bản ghi đến lúc ghi SQLite không có `await`, hai đoạn kiểm tra/ghi này không xen nhau trong cùng tiến trình JavaScript. I13:123 thử đủ **42 cặp có thứ tự** giữa hai trường khác nhau: bản thấp hơn đến muộn vẫn được áp dụng nếu trường đó chưa bị bản mới thay đổi.
4. **Bỏ yêu cầu hoàn toàn cũ:** SD:135–142 trả HTTP 200, `success:true`, `staleIgnored:true` khi mọi trường có mặt đều cũ. Không gọi upsert trong nhánh này. I13:144 xác nhận không làm hạ APPROVED/VERIFIED, không đổi hash hoặc thời gian xác minh. Khi có cả trường mới và trường cũ, API giữ trường cũ trong SQLite và áp dụng trường còn mới tại SD:145–175; I13:136 đạt.
5. **Gói dữ liệu thực tế:** Điểm danh chỉ gửi điểm danh/trạng thái cùng định danh; thẻ chỉ gửi thẻ/trạng thái. Tuy nhiên, mô tả “chỉ trường đã thay đổi” **không hoàn toàn đúng theo nghĩa đen**: ghi chú còn kèm `finalText` hiện tại tại SC:692–693; sửa một phần nhận xét gửi cả bốn trường nhận xét tại SC:574–580. Bộ kiểm chứng đã chạy đúng hành vi thực tế này và xác nhận không mất dữ liệu trong các tình huống đảo thứ tự đã thử. Không sửa phần đó trong vòng kiểm toán.

### Ma trận 42 nhóm trên trang

Mỗi ô trong hai cột kết quả bao gồm **ba trạng thái ban đầu DRAFT/APPROVED/VERIFIED**. Hai lần sửa được gọi liên tiếp, không chờ một lượt dựng lại giao diện giữa hai thao tác. Mỗi nhóm xác nhận đủ bảy trường trong SQLite không bị thay đổi sau yêu cầu/phản hồi cũ, giao diện giữ bản mới, trạng thái là DRAFT, và tải lại bằng cả trang hiện tại lẫn bộ xử lý trang mới vẫn đúng.

| Trường | Yêu cầu cũ đến API sau yêu cầu mới | Yêu cầu đến đúng thứ tự nhưng phản hồi cũ trả sau | Giá trị cuối / nội dung kiểm tra |
|---|---|---|---|
| Ghi chú / teacherNote | **3/3 đạt** | **3/3 đạt** | Giữ chuỗi rỗng do lần sửa mới nhất chủ động xóa |
| Thẻ / quickTags | **3/3 đạt** | **3/3 đạt** | Giữ `[]` sau thao tác thêm rồi bỏ thẻ |
| Điểm danh / attendanceStatus | **3/3 đạt** | **3/3 đạt** | Giữ `LATE`, không bị bản `PRESENT` cũ ghi đè |
| Điểm mạnh / strengths | **3/3 đạt** | **3/3 đạt** | Giữ `LATEST strengths` và các trường còn lại |
| Cải thiện / improvements | **3/3 đạt** | **3/3 đạt** | Giữ `LATEST improvements` và các trường còn lại |
| Rèn luyện / actionPlan | **3/3 đạt** | **3/3 đạt** | Giữ `LATEST actionPlan` và các trường còn lại |
| Nhận xét cuối / finalText | **3/3 đạt** | **3/3 đạt** | Giữ `LATEST finalText` và các trường còn lại |

Cả hai phản hồi của từng nhóm đều thực sự HTTP **200/200**. Với yêu cầu cũ đến API sau, phản hồi cũ có **`staleIgnored:true`**. Dữ liệu chi tiết từng tổ hợp nằm trong `observations` của [independent-results.json](independent-results.json).

**47 nhóm còn lại:** 42 cặp trường độc lập; 1 nhóm chỉ header đồng thời xóa thẻ/nội dung; 1 nhóm yêu cầu trộn trường cũ và mới; 1 nhóm bảo toàn APPROVED/VERIFIED; 1 nhóm tách học viên/buổi/lớp và kiểm tra bộ đếm khi quay lại buổi; 1 nhóm từ chối Host/Origin/Sec-Fetch-Site bên ngoài. Cộng với 42 nhóm trên = **89/89**.

### Giới hạn của kết luận R12-01

`fieldRevsByScope` là Map trong bộ nhớ của một mô-đun API (SD:5), tách theo mã trang. Chứng cứ này xác nhận thứ tự lưu của **cùng một trang và cùng một phiên mô-đun API**. Nó không chứng minh chống ghi đè giữa hai tab độc lập, qua khởi động lại server, hoặc giữa nhiều tiến trình server. Lời gọi không có phiên bản vẫn được chấp nhận theo nhánh tương thích SD:114–116. Đây là giới hạn của thiết kế hiện tại, không được diễn giải thành bảo vệ tuyệt đối mọi nguồn ghi SQLite. Các tình huống đó không phải tiêu chí gốc R12-01 được lưu trong báo cáo Vòng 12.

## 6. Bước còn chặn quyết định GO

**B13-BUILD — Chưa xác nhận được bước dựng hoàn chỉnh.** Đây là mã bước kiểm định, không phải lỗi mã nguồn mới được gán mức P1/P2.

- **Nguyên nhân quan sát:** chương trình dựng báo `spawn EPERM`, nghĩa là hệ điều hành/môi trường không cho tạo một tiến trình con. Biên dịch đã báo thành công; hai lần đầu ghi rõ dừng khi chuyển sang TypeScript. Chưa xác định chính xác chính sách hệ điều hành nào gây chặn; không suy diễn đó là lỗi TypeScript.
- **Vị trí:** lệnh `npm run build` → `next build` → bước tạo tiến trình tiếp theo sau biên dịch. `next.config.ts` chỉ cấu hình gói SQLite chạy phía server, không có tùy chọn bỏ qua lỗi kiểm tra kiểu.
- **Cách xử lý tiếp theo:** agent chạy lại đúng lệnh trên cùng mã nguồn trong phiên thực thi cho phép tiến trình con bình thường. Không cần sửa bản vá R12-01 để xử lý trở ngại này. Giữ nguyên các bước kiểm tra của bản dựng.
- **Điều kiện đóng:** mã thoát `0`, hoàn tất kiểm tra kiểu và tạo trang; lưu nhật ký mới, khôi phục `next-env.d.ts`, đối chiếu dấu vân tay mã nguồn. Nếu mã sản phẩm thay đổi, chạy lại kiểm chứng liên quan trên đúng bản mới trước quyết định GO.

**Chưa yêu cầu Owner đăng nhập, cung cấp mật khẩu hoặc tự chạy lệnh.** Phiên này không có cơ chế cấp quyền để tiếp tục bước đang bị chặn; báo cáo giữ nguyên giới hạn thay vì xác nhận một kết quả chưa có.

## 7. Kết quả và việc tiếp theo

**Đã làm:** Đọc bản vá/test, đối chiếu 49 mã lịch sử và 14 ca A, chạy các lệnh bắt buộc, bổ sung/chạy bộ kiểm chứng độc lập Vòng 13; lưu báo cáo, nhật ký và dấu vân tay mã. Cập nhật một dòng ghi nhận cuộc kiểm toán trong kế hoạch; không đánh dấu hoàn thành tính năng Giai đoạn 5.

**Kết quả:** R12-01 đạt; hồi quy của dự án đạt; hai bộ độc lập đạt 132/132 nhóm; TypeScript đạt. **NO-GO cho xác nhận chuyển Giai đoạn 5 tại thời điểm kiểm toán**, vì bản dựng bắt buộc còn bị môi trường chặn. Không phát hiện thêm lỗi sản phẩm có bằng chứng tái hiện trong phạm vi các tiêu chí đã thử.

**Chưa kiểm tra:** Bản dựng hoàn chỉnh, giao diện React/trình duyệt thật, LMS/Teaching/Gemini thật; tính đầy đủ của các báo cáo gốc Vòng 1–11 không có trong checkout. Giai đoạn 5 chưa được kiểm toán như một tính năng đã triển khai hoàn chỉnh.

**Việc tiếp theo:** Agent hoàn tất bước dựng trên đúng bản mã trong môi trường chạy được tiến trình con, bổ sung bằng chứng rồi chốt lại GO/NO-GO. Owner chưa cần thao tác tài khoản hoặc làm việc với mã nguồn.
