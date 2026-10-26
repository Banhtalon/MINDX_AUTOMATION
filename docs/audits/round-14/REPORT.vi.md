# Báo cáo kiểm toán độc lập Vòng 14 — Đóng B13-BUILD

Ngày **20/10/2026**, giờ Việt Nam. Dự án: MINDX Automation Bot.

**Kết luận cuối cùng: GO cấp mã nguồn để chuyển sang triển khai Giai đoạn 5.**

**B13-BUILD: ĐÓNG — ĐẠT.** Đã chạy trực tiếp đủ năm lệnh được yêu cầu trên cùng mã sản phẩm đã kiểm chứng ở Vòng 13; tất cả thoát `0`. Bản dựng hoàn tất biên dịch, kiểm tra TypeScript, thu thập dữ liệu trang, tạo **18/18 trang** và tối ưu hóa. Không còn `spawn EPERM`. Hai bộ độc lập chạy mới đạt **132/132 nhóm**, không có nhóm thất bại; **49/49 mã lịch sử Vòng 1–12**, gồm `R12-01`, đạt các tiêu chí còn lưu trong hồ sơ/test.

GO này xác nhận điều kiện mã nguồn để **bắt đầu triển khai** Giai đoạn 5. Không đánh dấu tính năng Giai đoạn 5 đã hoàn thành và không thay thế nghiệm thu trên LMS/Teaching/Gemini thật.

## 1. Phạm vi và cách thực hiện

- Thư mục chạy: `F:\MINDX_project test\MINDX-AUTOMATION`. HEAD nền: `2570d96b6770957e218031c91f14ce98e766dfa7`; Node `v24.21.0`, Next.js `16.4.2`, Windows. Bắt đầu chạy các lệnh lúc **11:01:33**, hoàn tất lúc **11:01:41** ngày 20/10/2026 (UTC+7); thời điểm chi tiết theo UTC có trong [commands.json](commands.json).
- Checkout có nhiều thay đổi chưa commit từ trước. Kết luận gắn với **nội dung file được băm tại phiên này**, không chỉ mã HEAD. Không commit, reset, xóa hay sửa những thay đổi có sẵn. Xem [git-status.before.txt](git-status.before.txt).
- Đọc và đối chiếu kế hoạch, báo cáo/dấu vân tay/công cụ kiểm chứng Vòng 13, bộ độc lập Vòng 12, các bài kiểm tra hồi quy, cấu hình dựng và cấu hình TypeScript. Đối chiếu tài liệu CLI/TypeScript đi kèm đúng phiên bản Next.js trong `node_modules/next/dist/docs/`. Vòng này tập trung đóng bước dựng, không mở một cuộc rà soát mới toàn bộ ứng dụng.
- Dùng nguyên các lệnh và bài kiểm chứng có sẵn. Công cụ [run-checks.mjs](run-checks.mjs) gọi lệnh qua shell Windows bình thường, giữ nguyên thư mục và môi trường đang có; lưu đầy đủ đầu ra chuẩn/lỗi vào cùng file nhật ký, giữ mã thoát thật. Không cài thư viện, không bỏ kiểm tra TypeScript, không đổi trình dựng hoặc sửa cấu hình để đạt kết quả.
- Hai bộ độc lập chạy SQLite thật ở chế độ `:memory:` (cơ sở dữ liệu thử riêng trong bộ nhớ), dùng dữ liệu giả và mô phỏng mạng, LMS, lịch cập nhật giao diện. Chúng đọc mã sản phẩm hiện tại khi chạy. Bộ Vòng 13 dùng lại phần dựng dữ liệu mô phỏng của Vòng 12; vì vậy **132 là tổng nhóm kiểm chứng, không phải 132 phép đo hoàn toàn tách biệt về công cụ**.
- Không thao tác LMS/Teaching thật, không gọi Gemini thật, không sử dụng cơ sở dữ liệu học viên thật hoặc phiên đăng nhập trình duyệt. Các tiến trình có nạp `.env.local` như dự án đang cấu hình; nhật ký chỉ ghi số biến được nạp, không ghi giá trị bí mật.

## 2. Đối chiếu SHA-256 và bảo toàn dữ liệu

SHA-256 là dấu vân tay tính từ từng byte của file. Đã so trực tiếp với [source-state.json Vòng 13](../round-13/source-state.json), không dựa vào lời mô tả kết quả cũ.

| Nội dung đối chiếu | Kết quả |
|---|---|
| HEAD hiện tại so với Vòng 13 | Khớp `2570d96b6770957e218031c91f14ce98e766dfa7` |
| Danh sách `src/`, `scripts/`, `data/config/` | Không thêm, thiếu hoặc xóa file so với danh sách Vòng 13 |
| 53 file trong dấu vân tay Vòng 13 tại đầu phiên | **52/53 khớp từng byte**; chỉ file kế hoạch khác |
| Khác biệt kế hoạch đầu phiên | Chỉ dòng `AUDIT-R13` do chính Vòng 13 thêm sau lúc chụp dấu vân tay; bỏ dòng đó thì khớp bản `plan.before.md` Vòng 13 |
| Mã sản phẩm, bài kiểm tra, cấu hình trong danh sách Vòng 13 | **Tất cả khớp SHA-256**, không có thay đổi mã sản phẩm |
| Phạm vi chụp bổ sung Vòng 14 | 57 file, gồm 53 file cũ và các file cấu hình/cache gốc bổ sung; không có mốc Vòng 13 để so quá khứ cho các file bổ sung |
| Sau kiểm tra và cập nhật hồ sơ | **56/57 file giữ nguyên** so đầu phiên; chỉ thêm dòng `AUDIT-R14` trong kế hoạch, mọi byte còn lại của kế hoạch được giữ nguyên |
| 30 file hồ sơ Vòng 12–13 có sẵn | **Tất cả giữ nguyên SHA-256** sau phiên, gồm báo cáo, công cụ, kết quả và nhật ký lịch sử |
| `next-env.d.ts` sau dựng | **Khôi phục đúng từng byte**, SHA-256 `b8b3a344484b959af5e4e3fc1a1609dac3cb9ece0cdeb6c145be29bc4c491000` |

Không khẳng định toàn bộ cây dự án khớp một mốc vốn chỉ bao phủ 53 file: cấu hình dựng gốc như `next.config.ts` không nằm trong danh sách Vòng 13, nên chỉ được kiểm tra hiện trạng và bảo toàn trong Vòng 14. Mốc cũ cũng không băm `node_modules` hay `.env.local`. Tuy nhiên, toàn bộ năm lệnh đã chạy lại trên môi trường hiện tại, thay vì suy ra kết quả từ mốc cũ.

Bằng chứng: [baseline-comparison.json](baseline-comparison.json), [source-state.json](source-state.json), [preservation-check.json](preservation-check.json). Các file `*.before.*` trong thư mục này là bản sao khôi phục. Hai bài độc lập tự ghi vào thư mục lịch sử; công cụ đã lưu bản chạy mới sang Vòng 14 rồi khôi phục bản lịch sử trong `finally`. `next-env.d.ts` cũng được khôi phục trong `finally` ngay khi lệnh dựng kết thúc. Thư mục `.next` chứa kết quả dựng mới; không phải thay đổi mã sản phẩm.

Bảng ánh xạ mã/tiêu chí/dòng mã dưới đây kế thừa hồ sơ Vòng 13. Mã nguồn tương ứng giữ nguyên SHA-256 và toàn bộ T, I12, I13 đã được chạy lại thành công tại Vòng 14; các nhãn PASS trong bảng chỉ kết quả chạy mới, không lấy kết quả cũ thay thế.

## 3. Quy ước bằng chứng mã nguồn

Số sau tên ngắn là **dòng mã của file hiện tại**; khoảng dòng chỉ phần mã liên quan. `I12:117 PASS` nghĩa là nhóm bắt đầu tại dòng 117 trong bộ độc lập Vòng 12 đã được chạy lại và đạt; kết quả nằm trong JSON/log Vòng 14 nêu trên. `T PASS` nghĩa là đã chạy thành công bộ hồi quy hiện tại của dự án. `I13` là bộ kiểm chứng Vòng 13, cũng được chạy lại tại Vòng 14.

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
| I12 | [bộ kiểm chứng Vòng 12](../round-12/verify-independent.mjs), chạy lại tại Vòng 14 đạt 43/43 |
| I13 | [bộ kiểm chứng Vòng 13](../round-13/verify-independent.mjs), chạy lại tại Vòng 14 đạt 89/89 |

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
| 12 / R12-01 | Yêu cầu lưu cũ thành công đến muộn không ghi đè bản mới đã lưu thành công | **Đạt** | SC:131–135,627–635,698–707; SD:89–175; T:2923–3011 PASS; I12:285 PASS; I13:40–183 PASS, xem mục 5 |

Tổng **49 mã lỗi lịch sử**: 14 + 11 + 7 + 6 + 4 + 7. Không có mã lịch sử nào bị quan sát tái xuất hiện trong các tiêu chí đã chạy. Bước dựng được kiểm chứng mới tại mục 6. Đây không phải chứng nhận không còn mọi lỗi trong ứng dụng.

## 5. Kết quả chạy mới đủ năm lệnh

| Lệnh bắt buộc | Mã thoát | Kết quả mới | Bằng chứng Vòng 14 |
|---|---|---|---|
| `npx tsx scripts/test-phase4-codex-repros.ts` | `0` | **Đạt** các nhóm hồi quy Vòng 1–12 | [regressions.log](regressions.log) |
| `node docs/audits/round-12/verify-independent.mjs` | `0` | **43/43 nhóm đạt**, 0 thất bại | [round12-independent.log](round12-independent.log), [round12-independent-results.json](round12-independent-results.json) |
| `node docs/audits/round-13/verify-independent.mjs` | `0` | **89/89 nhóm đạt**, 0 thất bại | [round13-independent.log](round13-independent.log), [round13-independent-results.json](round13-independent-results.json) |
| `npx tsc --noEmit --incremental false` | `0` | **Đạt**, không có thông báo lỗi kiểu dữ liệu | [typecheck.log](typecheck.log) rỗng đúng với lệnh thành công; mã thoát trong [commands.json](commands.json) |
| `npm run build` | `0` | **Đạt**, hoàn tất bản dựng với TypeScript và 18/18 trang | [build.log](build.log) đầy đủ |

Mã thoát `0` nghĩa là lệnh hoàn tất thành công. Số **132/132** là 43 + 89 nhóm của hai bộ độc lập; không cộng số nhóm hồi quy vào tổng đó. Những thông báo lỗi mạng cố ý tạo trong hồi quy và cảnh báo tính năng thử nghiệm `stripTypeScriptTypes` là đầu ra của tình huống thử, không phải lỗi lệnh. Đã đọc nhật ký và kiểm tra JSON từng nhóm, không chỉ dựa vào dòng “100%”.

### R12-01 và phạm vi bảo vệ được xác nhận lại

89 nhóm của bộ Vòng 13 tiếp tục đạt trên mã hiện tại: 42 tổ hợp của bảy trường × ba trạng thái ban đầu × hai thứ tự yêu cầu/phản hồi; 42 cặp có thứ tự giữa các trường khác nhau; năm nhóm còn lại kiểm tra metadata chỉ qua header, gói trộn cũ/mới, bảo toàn trạng thái đã duyệt/xác minh, tách lớp/buổi/học viên và từ chối yêu cầu bên ngoài.

Ở các ca đảo thứ tự, cả hai yêu cầu đều thực sự được bộ xử lý trả HTTP **200/200**; dữ liệu mới nhất còn nguyên sau yêu cầu/phản hồi cũ và sau khi đọc lại từ SQLite riêng. Với yêu cầu cũ đến sau, có `staleIgnored:true`. Chi tiết từng tổ hợp nằm trong `observations` của JSON chạy mới.

Giới hạn thiết kế từ Vòng 13 vẫn giữ nguyên: bộ nhớ thứ tự sửa nằm trong một mô-đun server, tách theo mã trang. Kết quả bảo vệ thứ tự trong cùng một trang và cùng phiên mô-đun; không chứng minh chống ghi đè giữa hai tab độc lập, sau khởi động lại server hoặc nhiều tiến trình server. Lời gọi không có thông tin phiên bản vẫn đi theo nhánh tương thích. Không mở rộng kết luận R12-01 vượt quá các tiêu chí đã kiểm chứng.

## 6. Đóng bước B13-BUILD

**B13-BUILD: ĐÓNG — ĐẠT.** Lần dựng duy nhất của Vòng 14 hoàn tất trên nguyên mã sản phẩm hiện có, không cần sửa lỗi sản phẩm hoặc nới lỏng kiểm tra.

Các mốc trong nhật ký mới:

```text
Compiled successfully in 668ms
Running TypeScript ...
Finished TypeScript in 223ms ...
Collecting page data using 20 workers ...
Generating static pages using 20 workers (18/18) in 731ms
Finalizing page optimization ...
Route (app)
```

Nhật ký có bảng tuyến trang/API đầy đủ, không có `spawn EPERM`, không bỏ qua kiểm tra kiểu. Đã xác nhận các file đầu ra không rỗng: `.next/BUILD_ID`, `.next/prerender-manifest.json`, `.next/routes-manifest.json`, `.next/server/app-paths-manifest.json`; SHA-256 được ghi trong `preservation-check.json`.

`next-env.d.ts` do Next.js sinh tạm có SHA-256 `1b59d4c6b83807db275d43f3cf2cc8e9323f465fab764eea091cc5becd5bad37`. Sau dựng, đã thay lại bằng bản sao ban đầu và so trực tiếp byte, cho hash gốc nêu ở mục 2. Không dùng `git checkout` vì thao tác đó có thể ghi đè thay đổi có sẵn của Owner.

Kết quả này cung cấp bằng chứng mới để gỡ bước chặn tại Vòng 13. Không sửa lại kết luận lịch sử NO-GO của Vòng 13; kết luận GO tại Vòng 14 thay thế quyết định chuyển giai đoạn ở thời điểm hiện tại.

## 7. Quyết định GO/NO-GO và giới hạn

| Điều kiện chốt cấp mã nguồn | Trạng thái |
|---|---|
| Mã sản phẩm trong dấu vân tay Vòng 13 không đổi | **Đạt** |
| 49 mã lịch sử Vòng 1–12, gồm R12-01 | **Đạt theo tiêu chí còn lưu và chạy lại** |
| Hồi quy hiện tại | **Đạt** |
| Hai bộ kiểm chứng độc lập | **132/132 đạt** |
| Kiểm tra TypeScript riêng | **Đạt** |
| Bản dựng hoàn chỉnh B13-BUILD | **Đạt — đã đóng** |
| Khôi phục next-env và bảo toàn hồ sơ lịch sử | **Đạt** |
| Quyết định chuyển sang triển khai Giai đoạn 5 | **GO cấp mã nguồn** |

Không còn bước chặn cấp mã nguồn trong phạm vi Vòng 14. Không phát hiện tiêu chí lịch sử nào tái xuất hiện qua các lệnh đã chạy. Đây không phải chứng nhận ứng dụng không còn mọi lỗi.

**Chưa kiểm tra / không thuộc kết luận này:**

- Không có báo cáo gốc riêng của Vòng 1–11 trong checkout; bảng 49 mã dựa vào ánh xạ còn lưu ở Vòng 12–13 và bộ test hiện có. Không xác nhận từng báo cáo gốc không có thêm yêu cầu khác.
- Chưa chạy giao diện bằng trình duyệt/React thật, chưa chạy server phục vụ bản dựng để nghiệm thu thao tác người dùng; kiểm tra handler giao diện bằng mô phỏng không thay cho thử trên trình duyệt.
- Chưa xác minh dữ liệu điểm khớp LMS thật trên mọi trang và chưa nghiệm thu luồng ghi/đọc lại LMS, Teaching, Gemini thật trong vòng này.
- Chưa triển khai hoặc nghiệm thu các chức năng mới Giai đoạn 5: tải bài kèm định danh, đọc file đa môn, đề xuất điểm theo barem và lưu điểm lên LMS. Các ô TASK-5.x giữ nguyên chưa hoàn thành.
- Không thực hiện quét lỗ hổng toàn bộ thư viện, kiểm thử tải hoặc chứng nhận khả năng dùng nhiều tab/nhiều tiến trình. Đây là giới hạn phạm vi, không phải lỗi mới được gán mã mà chưa có bằng chứng.

## 8. Hồ sơ đã cập nhật và bước tiếp theo

**Đã làm:** Lưu báo cáo Vòng 14 có đủ 49 mã lịch sử và 14 ca A; đối chiếu SHA-256 trước/sau; chạy đủ năm lệnh; lưu nhật ký đầy đủ, mã thoát và hai bộ kết quả mới; khôi phục file phát sinh; kiểm tra bảo toàn bằng [verify-preservation.mjs](verify-preservation.mjs). Chỉ thêm dòng `AUDIT-R14` đã hoàn thành trong `MINDX_AUTOMATION_PLAN.md`, giữ nguyên dòng R13 và các task sản phẩm.

**Kết quả:** **GO cấp mã nguồn để chuyển sang triển khai Giai đoạn 5.** **B13-BUILD đã đóng**, năm lệnh đều thành công; 132/132 nhóm độc lập và 49/49 mã lịch sử đạt trong phạm vi đã nêu.

**Chưa kiểm tra:** Các phần thử nghiệm thực tế và giới hạn liệt kê ở mục 7; không lấy GO cấp mã nguồn làm nghiệm thu tính năng Giai đoạn 5.

**Việc tiếp theo:** Bắt đầu TASK-5.1 theo kế hoạch bằng một nhiệm vụ triển khai riêng; kiểm chứng định danh và file tải về trước khi mở rộng sang chấm/lưu điểm. Owner chưa cần chạy lệnh, đăng nhập hoặc cung cấp thông tin tài khoản cho công việc kiểm toán Vòng 14 này.
