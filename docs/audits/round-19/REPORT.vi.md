# Kiểm toán độc lập Vòng 19 — Giai đoạn 5

**Kết luận: NO-GO cho Giai đoạn 5.** Chưa đủ điều kiện dùng luồng chấm/lưu bài tự động với dữ liệu thật. Bộ kiểm tra hiện có và build đạt, nhưng bộ độc lập tái hiện 20 ca lỗi thuộc 14 nhóm: 10 nhóm P1 (cần xử lý trước khi dùng) và 4 nhóm P2 (cần hoàn thiện để đạt các yêu cầu đã nêu). Không sửa mã sản phẩm trong vòng kiểm toán này.

## 1. Phiên bản và phạm vi

- Ngày kiểm toán: 20/10/2026, múi giờ Việt Nam UTC+7. Mốc snapshot: 2026-10-20T10:08:43.356Z.
- HEAD: `2570d96b6770957e218031c91f14ce98e766dfa7`. Đây là cây làm việc có nhiều thay đổi chưa commit, **không chỉ riêng nội dung tại HEAD**. Trạng thái đầu/cuối nằm trong [git-status.before.txt](git-status.before.txt) và [git-status.after.txt](git-status.after.txt).
- Dấu vân tay SHA-256 của danh mục nguồn đầu vòng: `aec879043000afe45ce8fcae1896d06933020f5beffdcc88316e0ef73f2f8f26`; danh mục từng file trong [source-state.json](source-state.json). Kế hoạch trước cập nhật có bản sao byte-for-byte [plan.before.md](plan.before.md).
- Đã rà soát 15 file chính TASK-5.1…5.5, theo toàn bộ luồng tải → đọc file → AI → sửa/duyệt → lưu LMS → đối chiếu; danh mục/hash ở [review-scope.json](review-scope.json). Đọc thêm SQLite, rào đường dẫn, rào yêu cầu cục bộ, bộ quản lý trình duyệt, hàng đợi, bộ lọc mạng, selectors, cấu hình và luồng bảng điểm liên quan.
- Giả định vận hành: ứng dụng trên máy giáo viên, có thể có nhiều tab cùng lúc; file học viên là dữ liệu không tin cậy. Không đánh giá hệ thống nhiều máy/người dùng đồng thời.
- Không thay các dấu TASK-5.x đã tích sẵn thành bằng chứng nghiệm thu. AUDIT-R19 ghi hoàn thành **việc kiểm toán**, kết quả Giai đoạn 5 vẫn NO-GO. GO ở Vòng 18 chỉ cho phép bắt đầu triển khai Giai đoạn 5 và không chứng nhận tính năng mới.

## 2. Cô lập và bảo toàn

Các lệnh bắt buộc chạy tại bản sao `C:\Users\QQ\AppData\Local\Temp\mindx-round19-t3RoFj`, với mã nguồn đúng snapshot và bản sao riêng của node_modules. Không cài/cập nhật thư viện. Không mang theo .env, .env.local, .env.production, DB thật, hồ sơ đăng nhập trình duyệt hoặc thư mục bài nộp thật. Chỉ sao chép data/config phục vụ kiểm tra; cấu hình gốc không bị ghi.

Môi trường chạy được tạo từ danh sách biến hệ thống tối thiểu; không kế thừa mật khẩu/khóa dịch vụ. npm ở chế độ offline, tắt telemetry và có [network-guard.cjs](network-guard.cjs) chặn socket Node ra ngoài máy. Đây là rào ở tiến trình Node, **không phải tường lửa hệ điều hành**. Không khởi động trình duyệt thật. Các ca tải/lưu thay Playwright bằng DOM/API giả; Gemini bằng model giả.

Bộ độc lập R19 tự chuyển vào thư mục tạm để tạo fixture và dùng SQLite `:memory:` (chỉ trong bộ nhớ). Không import các module ứng dụng để thực thi thật: đọc nguồn, bỏ import/type, chạy nguyên thân hàm trong VM với liên kết được khai báo rõ. Những bài kiểm tra có sẵn có thể tạo DB giả trong bản sao; không mở/kết nối DB gốc.

- [snapshot-check.json](snapshot-check.json): nguồn và hồ sơ bảo vệ khớp snapshot; các dữ liệu riêng tư nêu trên không có trong snapshot lúc bắt đầu.
- [isolation.json](isolation.json): phạm vi môi trường và giới hạn rào mạng.
- [preservation-check.json](preservation-check.json): **194/194 file bảo vệ giữ nguyên SHA-256**, không có file bị thêm/xóa/đổi trong next-env.d.ts và toàn bộ round-12…round-18 ở cây gốc. Cụ thể next-env.d.ts + 193 file lịch sử.
- Mã sản phẩm, cấu hình, script cũ và tsconfig.tsbuildinfo trong danh mục đầu vòng không đổi; thay đổi nguồn được phép duy nhất là bổ sung AUDIT-R19 vào MINDX_AUTOMATION_PLAN.md.

## 3. Kết quả chín lệnh bắt buộc

| Lệnh | Mã thoát cuối | Kết quả | Nhật ký |
|---|---:|---|---|
| `npx tsx scripts/test-phase5.ts` | 0 | Đạt | [phase5.log](phase5.log) |
| `npx tsx scripts/test-phase4-codex-repros.ts` | 0 | Đạt | [phase4.log](phase4.log) |
| `node docs/audits/round-12/verify-independent.mjs` | 0 | Đạt | [round12-independent.log](round12-independent.log) |
| `node docs/audits/round-13/verify-independent.mjs` | 0 | Đạt | [round13-independent.log](round13-independent.log) |
| `node docs/audits/round-16/verify-independent.mjs` | 0 | Đạt | [round16-independent.log](round16-independent.log) |
| `node docs/audits/round-17/verify-independent.mjs` | 0 | Đạt | [round17-independent.log](round17-independent.log) |
| `node docs/audits/round-19/verify-independent.mjs` | 1 | 74/94 đạt; 20 trượt có bằng chứng | [round19-independent.attempt-4.log](round19-independent.attempt-4.log) |
| `npx tsc --noEmit --incremental false` | 0 | Đạt | [typecheck.log](typecheck.log) |
| `npm run build` | 0 | Build thành công; sinh đủ 22/22 trang | [build.log](build.log) |

Đã chạy đủ 9/9 lệnh; 8 lệnh thoát 0. Lệnh độc lập R19 thoát 1 vì phát hiện lỗi sản phẩm, không được đổi thành đạt chỉ vì các lệnh còn lại xanh. [commands.json](commands.json) giữ thời gian bắt đầu/kết thúc, thư mục chạy, mã thoát và hash nhật ký của **mọi lần chạy**.

Các lần phát triển bộ kiểm tra cũng được giữ: lần 1 lỗi xử lý export type trong bộ nạp kiểm tra, chưa chạy ca; lần 2 phát hiện double tải không phân biệt selector nút/link, khiến control tải thất bại; không dùng hai lần này để kết luận lỗi tải. Lần 3 đã sửa control, tái hiện 19 ca lỗi/87 ca. Lần 4 cuối bổ sung 7 ca kiểm tra hợp lệ và bộ lọc mạng thật: **74/94 đạt, 20 trượt**; toàn bộ control đạt. Không sửa mã sản phẩm giữa các lần. Kết quả chuẩn cuối nằm ở [independent-results.json](independent-results.json).

## 4. Không hồi quy Giai đoạn 1–4

| Bộ độc lập được chạy lại trên snapshot hiện tại | Đạt | Trượt |
|---|---:|---:|
| Vòng 12 | 43/43 | 0 |
| Vòng 13 | 89/89 | 0 |
| Vòng 16 | 16/16 | 0 |
| Vòng 17 | 38/38 | 0 |
| Tổng nhóm kiểm tra cũ | 186/186 | 0 |

Bộ scripts/test-phase4-codex-repros.ts cũng thoát 0; đã xem hết kết quả chứ không chỉ đọc dòng thông báo cuối. Nhật ký có lỗi mô phỏng/stack trace trong các ca cố ý gây lỗi; exit code vẫn được thu trực tiếp, không đi qua đường ống làm mất mã thoát.

Các nhóm cũ bao phủ định danh, phân trang/roster/cache, bốn trạng thái điểm, xuất báo cáo, nhận xét/Zalo, thiếu dữ kiện AI, xung đột chỉnh sửa, lưu có đối chiếu, rào cục bộ và vòng đời browser. **Không thấy hồi quy trong tập kiểm tra đã chạy**. Đây là bằng chứng tổng hợp trên dữ liệu giả; chưa chứng minh mọi hành vi Giai đoạn 1–4 với tài khoản/dữ liệu/LMS thật. Các lỗi mới ở bảng chấm tự động được liệt kê riêng bên dưới.

## 5. Đối chiếu TASK-5.1…TASK-5.5

| Task | Phần đã xác nhận | Phần chưa đạt |
|---|---|---|
| TASK-5.1 — tải bài và khóa ID | Luồng tải hợp lệ ghi ID/path/SHA-256; không đòi bản ghi điểm danh; chặn đổi chủ submissionId; tên đường dẫn được làm sạch và qua allowlist; tải lại cùng hash giữ APPROVED/VERIFIED | Sai modal cùng tên có thể gán nhầm file; lessonId/session không được đối chiếu đủ (R19-07/08) |
| TASK-5.2 — đọc file đa môn | Các định dạng code yêu cầu, Scratch project.json, GameMaker; MIME/Base64 giữ bytes; ZIP chặn ../, đường dẫn tuyệt đối/ổ đĩa, 201 file, độ sâu 11 thành phần, 55MB khai báo, tỷ lệ nén cao; bỏ thư mục rác; đường dẫn ngoài/junction bị chặn | ZIP bỏ qua file mã nguồn hỏng; media bị cắt cụt vẫn PARSED (R19-01). Test dung lượng là gói khai báo vượt ngưỡng để kiểm tra chặn sớm, không phải thử gây cạn RAM thật |
| TASK-5.3 — AI/kiểm toán điểm | TS tự cộng tổng; chặn âm/vượt/NaN/chuỗi, thiếu/trùng/lạ tiêu chí AI, thiếu evidence/reason; scrub tên bản thân/bạn học trong văn bản; sandbox vô hiệu hóa thẻ thoát; bảo vệ APPROVED/VERIFIED; PARSE_ERROR không gọi AI và bị cấm duyệt | Barem trùng mã, hash cũ chưa đủ và kết quả AI ghi đè file mới (R19-02/03/04) |
| TASK-5.4 — ghi LMS | Control GRADE/REDO chọn radio đúng; GRADE điền điểm và nhận xét dạng text; HTTP 500, GraphQL errors, điểm đọc lại sai và drift trước/trong Save đều bị chặn | ID modal, API nghiệp vụ, nhận xét đọc lại, lần cập nhật VERIFIED cuối còn lỗi (R19-07/09/10/11) |
| TASK-5.5 — giao diện/API | Có đủ hai tab, chọn buổi/barem, preview, điểm thành phần, duyệt và lưu; rào Origin ở route; cấm đặt VERIFIED bằng API nháp; save-lms đi qua hàng đợi; các kiểm tra bảng điểm cũ đạt | Duyệt bỏ kiểm toán, duyệt cũ, sai phạm vi buổi, tải danh sách cũ, lỗi lưu nháp bị giấu và tiếp tục chấm sau lỗi tải (R19-05/06/08/12/13/14) |

Bổ sung về các rào bắt buộc: dev/start được cấu hình -H 127.0.0.1; hai route mới điều khiển Playwright đều enqueue qua hàng đợi; BrowserManager vẫn dùng persistent context playwright-auth. Không thấy import cấu hình chứa mật khẩu/khóa AI vào hai Client Components được rà soát. Các lần đọc file bài nộp chính đi qua assertPathAllowed. Đây là đối chiếu mã nguồn, không phải đo một server/trình duyệt đang chạy thật.

PARSE_ERROR hiện được lưu PENDING/GRADE, không gọi Gemini, không tự chọn REDO và không qua API duyệt/worker. calculatedScore=0 trong bản ghi lỗi là giá trị mặc định, **không phải một điểm 0 đã được chấm hay ghi LMS**; UI vẫn trình bày 0/100 nên chưa coi đó là bằng chứng đã chấm. Cần sửa R19-01/04 để giữ đúng cờ lỗi từ đầu đến cuối.

## 6. Các phát hiện cần xử lý

P1 là nguy cơ sai bài/điểm/dữ liệu hoặc xác nhận lưu sai; P2 là sai hợp đồng kiểm tra/giao diện có tái hiện cụ thể. Tất cả là lỗi mở, chưa có sửa trong vòng này.

### R19-01 — P1 — File hỏng vẫn được coi là đã đọc thành công

- **Phạm vi / vị trí:** TASK-5.2; [src/lib/file-parsers/archive-reader.ts:362-374](../../../src/lib/file-parsers/archive-reader.ts#L362), [src/lib/file-parsers/media-reader.ts:35-63](../../../src/lib/file-parsers/media-reader.ts#L35).
- **Nguyên nhân:** ZIP chỉ thêm file mà parseCodeBuffer đọc thành công, bỏ qua lỗi của các file mã nguồn còn lại. Bộ đọc ảnh/PDF chỉ nhìn vài byte chữ ký, chưa xác nhận cấu trúc file.
- **Tái hiện và kết quả:** ZIP có readme.txt đọc được và main.py chứa byte nhị phân trả PARSED, parsedCodeFiles=1, totalFiles=2. PNG chỉ có 8 byte chữ ký cũng trả PARSED và được chuyển thành inlineData.
- **Ảnh hưởng:** AI có thể chấm dự án sau khi bỏ mất file chính; ảnh bị cắt cụt không vào nhánh PARSE_ERROR. Ca ZIP là P1; ca media là P2 trong cùng nhóm xử lý lỗi đọc file.
- **Cách sửa nhỏ nhất:** Nếu một file mã nguồn thuộc loại được hỗ trợ bị lỗi, trả lỗi kèm đường dẫn file và khóa chấm tự động cho gói đó. Xác nhận media bằng bộ đọc định dạng hoặc cơ chế kiểm tra cấu trúc đáng tin cậy trước khi gửi AI.
- **Sau khi sửa:** Hai ca phải trả PARSE_ERROR; không gọi AI, không ghi điểm hoặc REDO lên LMS.
- **Ca độc lập:** `R19-01-mixed-corrupt`, `R19-01-truncated-media`; trạng thái **OPEN**.

### R19-04 — P1 — AI cũ có thể ghi đè file mới và xóa cờ PARSE_ERROR

- **Phạm vi / vị trí:** TASK-5.3; [src/lib/gemini/homework-grader.ts:332-346](../../../src/lib/gemini/homework-grader.ts#L332), [src/lib/gemini/homework-grader.ts:501-511](../../../src/lib/gemini/homework-grader.ts#L501), [src/lib/gemini/homework-grader.ts:541-562](../../../src/lib/gemini/homework-grader.ts#L541).
- **Nguyên nhân:** Ảnh chụp trước khi gọi AI không gồm fileHash, localFilePath và parseStatus. Kiểm tra sau AI vì thế không phát hiện thay đổi nguồn bài nộp nếu các trường điểm/nhận xét chưa đổi.
- **Tái hiện và kết quả:** Trong lúc model giả đang xử lý, cập nhật fileHash=file-v2 và PARSE_ERROR. Khi AI cũ trả về, chúng bị thay lại bằng hash của file-v1, PARSED và WAITING_APPROVAL.
- **Ảnh hưởng:** Đề xuất điểm của file cũ được gắn lên trạng thái mới; cờ cần giáo viên kiểm tra thủ công bị mất.
- **Cách sửa nhỏ nhất:** Chụp và đối chiếu đầy đủ phiên bản bài nộp, đặc biệt hash/path/trạng thái đọc file, rồi ghi có điều kiện trong cùng thao tác DB. Giữ nguyên bản mới nếu lệch.
- **Sau khi sửa:** Kết quả AI cũ bị bỏ qua; file-v2 và PARSE_ERROR còn nguyên. Các ca bảo vệ APPROVED/VERIFIED vẫn đạt.
- **Ca độc lập:** `R19-04-ai-file-drift`; trạng thái **OPEN**.

### R19-05 — P1 — API duyệt bỏ qua kiểm toán tiêu chí và bằng chứng đã đọc file

- **Phạm vi / vị trí:** TASK-5.5; [src/app/api/homework-grader/approve/route.ts:32-79](../../../src/app/api/homework-grader/approve/route.ts#L32), [src/app/api/homework-grader/approve/route.ts:132-170](../../../src/app/api/homework-grader/approve/route.ts#L132), [src/app/api/homework-grader/submissions/route.ts:198-245](../../../src/app/api/homework-grader/submissions/route.ts#L198).
- **Nguyên nhân:** API duyệt chỉ cộng earnedPoints và kiểm tra tổng 0–100; không gọi auditCriterionGrades với barem đã khóa. API lưu nháp cho phép tạo bản ghi mới và mặc định PARSED dù chưa có file/hash.
- **Tái hiện và kết quả:** Hai mục -10 và 110, có mã tiêu chí lạ và thiếu bằng chứng, vẫn trả HTTP 200, APPROVED, tổng 100. Một bản ghi mới không có file/path/hash cũng được tạo PARSED rồi duyệt APPROVED.
- **Ảnh hưởng:** Các rào chắn điểm thành phần và đọc file bị vượt qua tại bước cuối trước LMS; kiểm tra input trên giao diện không đủ bảo vệ.
- **Cách sửa nhỏ nhất:** Khóa barem/phiên bản barem cho bài chấm; kiểm toán từng tiêu chí ở cả duyệt đơn và hàng loạt. Không cho API nháp tự tạo chứng nhận PARSED; yêu cầu bản tải/parse đã được hệ thống xác nhận.
- **Sau khi sửa:** Hai yêu cầu giả bị từ chối; duyệt đúng và giáo viên gán điểm trong phạm vi cho phép vẫn hoạt động.
- **Ca độc lập:** `R19-05-invalid-criteria`, `R19-05-undownloaded`; trạng thái **OPEN**.

### R19-06 — P1 — Bản duyệt cũ ghi đè nhận xét giáo viên vừa sửa

- **Phạm vi / vị trí:** TASK-5.5; [src/app/api/homework-grader/approve/route.ts:145-206](../../../src/app/api/homework-grader/approve/route.ts#L145), [src/components/homework-auto-grader-tab.tsx:353-385](../../../src/components/homework-auto-grader-tab.tsx#L353).
- **Nguyên nhân:** Yêu cầu duyệt gửi lại toàn bộ nội dung nhưng không mang số phiên bản/hash của bản đang xem. Server ghi lại nội dung đó mà không kiểm tra nó đã cũ chưa.
- **Tái hiện và kết quả:** Giữ một bản cũ, lưu nhận xét LATEST TEACHER EDIT, sau đó gửi yêu cầu duyệt từ bản cũ. HTTP 200 khôi phục APPROVED FEEDBACK và đánh dấu APPROVED.
- **Ảnh hưởng:** Giáo viên mất chỉnh sửa mới; LMS có thể nhận bản cũ đã được duyệt nhầm.
- **Cách sửa nhỏ nhất:** Duyệt phải kèm phiên bản kỳ vọng của bản đang xem; nếu DB đã đổi thì trả 409, giữ nội dung mới và yêu cầu xem lại. Không dùng nội dung từ yêu cầu cũ để khôi phục dữ liệu.
- **Sau khi sửa:** Ca duyệt cũ nhận 409; nhận xét mới còn nguyên; duyệt lại từ phiên bản mới thành công.
- **Ca độc lập:** `R19-06-stale-approval`; trạng thái **OPEN**.

### R19-07 — P1 — Tên trùng hoặc modal trống vẫn qua kiểm tra định danh

- **Phạm vi / vị trí:** TASK-5.1 / TASK-5.4; [src/lib/playwright/download-submissions.ts:534-555](../../../src/lib/playwright/download-submissions.ts#L534), [src/lib/playwright/grade-worker.ts:267-306](../../../src/lib/playwright/grade-worker.ts#L267).
- **Nguyên nhân:** Dòng/modal được chấp nhận khi khớp tên HOẶC mã học viên HOẶC mã bài. Worker còn bỏ qua chặn định danh nếu modalText rỗng. Tên hiển thị chưa đủ chứng minh đúng submissionId.
- **Tái hiện và kết quả:** DOM giả hiện cùng tên nhưng S2/SUB_OTHER: downloader tải nội dung S2, lưu studentId=S1/submissionId=SUB1 kèm hash của S2. Worker cũng bấm Lưu và VERIFIED trên modal S2/SUB_OTHER, hoặc modal trống.
- **Ảnh hưởng:** Vi phạm điều kiện quan trọng nhất: có thể ghép nhầm bài hoặc ghi điểm sai người/bài.
- **Cách sửa nhỏ nhất:** Bắt buộc xác minh bộ ID lớp/buổi/học viên/bài nộp từ thuộc tính DOM hoặc phản hồi nghiệp vụ đã khóa. Thiếu hoặc mâu thuẫn ID thì dừng; tên chỉ dùng hiển thị. Không dùng nút mở modal chung khi chưa chứng minh đúng đối tượng.
- **Sau khi sửa:** Cả ba ca không được tải/ghi LMS; ca đúng ID vẫn chạy. Chưa dùng LMS thật để xác nhận vị trí ID trên website.
- **Ca độc lập:** `R19-07-wrong-download`, `R19-07-modal-same-name`, `R19-07-modal-empty`; trạng thái **OPEN**.

### R19-08 — P1 — lessonId của buổi khác được gắn vào session đang chọn

- **Phạm vi / vị trí:** TASK-5.1 / TASK-5.5; [src/lib/playwright/download-submissions.ts:126-129](../../../src/lib/playwright/download-submissions.ts#L126), [src/lib/playwright/download-submissions.ts:161-176](../../../src/lib/playwright/download-submissions.ts#L161), [src/app/api/homework-grader/submissions/route.ts:47-58](../../../src/app/api/homework-grader/submissions/route.ts#L47).
- **Nguyên nhân:** lessonId ưu tiên chọn cột mà không kiểm tra cột đó thuộc sessionNumber. Khi không tìm thấy còn rơi về thứ tự cột; sessionId được giữ nguyên để ghi DB.
- **Tái hiện và kết quả:** Gửi session _SESS_01 và lessonId=L2 của Buổi 2: tải thành công SUB2 và ghi vào _SESS_01.
- **Ảnh hưởng:** AI có thể dùng đề/barem Buổi 1 để chấm bài Buổi 2; bản ghi bị khóa sai phạm vi buổi học.
- **Cách sửa nhỏ nhất:** Đối chiếu lessonId, sessionId, số buổi và loại bài theo ánh xạ có thẩm quyền. Từ chối mâu thuẫn hoặc thiếu ánh xạ; áp dụng thống nhất cho list/download/save, bỏ suy đoán theo vị trí cột.
- **Sau khi sửa:** Yêu cầu L2/session01 bị chặn trước tải và ghi DB; cặp đúng vẫn được hỗ trợ.
- **Ca độc lập:** `R19-08-session-lesson`; trạng thái **OPEN**.

### R19-09 — P1 — Phản hồi không phải lưu điểm vẫn được coi là thành công

- **Phạm vi / vị trí:** TASK-5.4; [src/lib/playwright/grade-worker.ts:380-447](../../../src/lib/playwright/grade-worker.ts#L380), [src/lib/playwright/network-interceptor.ts:76-125](../../../src/lib/playwright/network-interceptor.ts#L76).
- **Nguyên nhân:** Worker lọc bằng chuỗi mindx.edu.vn, POST, và matchedIdentity chỉ cần studentId hoặc submissionId; không khóa operationName của thao tác lưu điểm. Điểm/decision/nhận xét không bắt buộc hiện diện.
- **Tái hiện và kết quả:** GetStudentProfile với variables.studentId=S1 được predicate chấp nhận; worker có thể VERIFIED nếu ô đã có 80/100. Ca bổ sung chạy NetworkInterceptor thật cũng xác nhận bộ lọc nhận truy vấn này.
- **Ảnh hưởng:** Một phản hồi nền 200 có thể bị nhầm thành bằng chứng LMS đã lưu bài đang chấm.
- **Cách sửa nhỏ nhất:** Khóa origin/path, operationName của mutation lưu điểm thực tế, đủ bộ ID cùng điểm/decision/nhận xét chuẩn hóa. HTTP 200/201 và không có GraphQL errors chỉ là bước sau khi đã khớp đúng nghiệp vụ.
- **Sau khi sửa:** Ba ca truy vấn/thiếu ID phải bị từ chối; mutation đúng được nhận, HTTP 500 và GraphQL errors tiếp tục bị chặn.
- **Ca độc lập:** `R19-09-unrelated-api`, `R19-09-missing-submission`, `R19-09-real-interceptor`; trạng thái **OPEN**.

### R19-10 — P1 — VERIFIED dù chưa điền và chưa đọc lại nhận xét

- **Phạm vi / vị trí:** TASK-5.4; [src/lib/playwright/grade-worker.ts:318-353](../../../src/lib/playwright/grade-worker.ts#L318), [src/lib/playwright/grade-worker.ts:492-521](../../../src/lib/playwright/grade-worker.ts#L492).
- **Nguyên nhân:** Không tìm thấy radio/input/editor thì worker bỏ qua mà không báo lỗi. Sau Save chỉ kiểm tra văn bản ô điểm hoặc chữ làm lại, không mở lại đúng bài để so nhận xét.
- **Tái hiện và kết quả:** DOM giả không có editor, ô điểm đã là 80/100. editorText rỗng nhưng verifiedCount=1; modal chỉ được đọc một lần trước Save.
- **Ảnh hưởng:** Điểm có thể đúng nhưng nhận xét chưa lưu hoặc quyết định chưa đúng vẫn hiện đã khớp LMS.
- **Cách sửa nhỏ nhất:** Thiếu trường bắt buộc phải dừng. Sau lưu, đọc lại đúng submission, kiểm tra radio/trạng thái, điểm và nhận xét theo cùng quy tắc chuẩn hóa; chỉ đánh dấu VERIFIED khi tất cả khớp.
- **Sau khi sửa:** Ca thiếu editor không được VERIFIED; thêm ca nhận xét sai/thiếu và quyết định sai đều phải thất bại.
- **Ca độc lập:** `R19-10-no-feedback`; trạng thái **OPEN**.

### R19-11 — P1 — Sửa sau phản hồi API vẫn bị nâng thành VERIFIED

- **Phạm vi / vị trí:** TASK-5.4; [src/lib/playwright/grade-worker.ts:471-521](../../../src/lib/playwright/grade-worker.ts#L471), [src/lib/db/sqlite.ts:849-857](../../../src/lib/db/sqlite.ts#L849).
- **Nguyên nhân:** Kiểm tra DB sau API xảy ra trước một khoảng chờ và lần đọc DOM. markVerified cuối cùng chỉ có điều kiện submissionId, không kiểm tra hash/phiên bản/trạng thái hiện tại.
- **Tái hiện và kết quả:** Khi worker đang đọc lại ô điểm, giáo viên đổi nhận xét thành LATEST AFTER API và hạ về WAITING_APPROVAL. Worker sau đó đánh dấu chính bản mới này VERIFIED.
- **Ảnh hưởng:** Một nội dung chưa được duyệt và chưa được gửi lên LMS có thể mang nhãn đã đối chiếu thành công.
- **Cách sửa nhỏ nhất:** Cập nhật VERIFIED có điều kiện bằng hash/phiên bản của bản đã gửi và trạng thái hợp lệ. Nếu không cập nhật được đúng một bản ghi, giữ trạng thái mới và báo cần duyệt lại.
- **Sau khi sửa:** Ca sửa trong lần đọc DOM giữ WAITING_APPROVAL và verifiedCount=0; ca bình thường, trước click và sau click vẫn đúng.
- **Ca độc lập:** `R19-11-readback-race`; trạng thái **OPEN**.

### R19-14 — P1 — Tải bài thất bại vẫn chấm cache cũ và trả thành công

- **Phạm vi / vị trí:** TASK-5.5; [src/app/api/homework-grader/download-and-grade/route.ts:62-90](../../../src/app/api/homework-grader/download-and-grade/route.ts#L62), [src/app/api/homework-grader/download-and-grade/route.ts:123-164](../../../src/app/api/homework-grader/download-and-grade/route.ts#L123), [src/components/homework-auto-grader-tab.tsx:240-264](../../../src/components/homework-auto-grader-tab.tsx#L240).
- **Nguyên nhân:** Route không kiểm tra downloadResult.success trước khi đọc toàn bộ bản ghi session từ DB để gọi AI. Nhánh skipAi và phản hồi cuối đều đặt success=true.
- **Tái hiện và kết quả:** Downloader giả trả success=false/error=LMS failed, DB có bản cũ. Route vẫn gọi gradeBatchSubmissions một lần và trả HTTP 200, success=true.
- **Ảnh hưởng:** Giáo viên có thể nhận đề xuất từ bài cũ khi tưởng vừa tải bài mới; lỗi tải bị che bằng thông báo hoàn tất.
- **Cách sửa nhỏ nhất:** Dừng AI khi tải thất bại; nếu chỉ lỗi một số bài thì nêu rõ kết quả từng bài và chỉ chấm bản đã tải/xác minh đúng trong lượt đó. Trả trạng thái tổng phản ánh thất bại, kể cả skipAi.
- **Sau khi sửa:** Ca tải thất bại không gọi AI và trả success=false; lượt thành công vẫn chấm đúng danh sách đã xác minh.
- **Ca độc lập:** `R19-14-route-download-failure`; trạng thái **OPEN**.

### R19-02 — P2 — Barem trùng mã tiêu chí được cộng hai lần

- **Phạm vi / vị trí:** TASK-5.3 / TASK-5.5; [src/lib/gemini/score-auditor.ts:74-84](../../../src/lib/gemini/score-auditor.ts#L74), [src/lib/gemini/score-auditor.ts:114-166](../../../src/lib/gemini/score-auditor.ts#L114), [src/components/homework-auto-grader-tab.tsx:698-711](../../../src/components/homework-auto-grader-tab.tsx#L698).
- **Nguyên nhân:** rubricMap ghi đè mã trùng, nhưng vòng tính điểm vẫn duyệt toàn bộ barem ban đầu. Nút thêm tiêu chí lấy mã từ độ dài danh sách, nên sau khi xóa một tiêu chí ở giữa có thể tạo lại mã đã có.
- **Tái hiện và kết quả:** Barem có hai C1, mỗi mục tối đa 50; AI trả một C1 đạt 50. Bộ kiểm toán trả valid=true, hai mục kết quả và tổng 100.
- **Ảnh hưởng:** Một yêu cầu được đánh giá hai lần, tổng điểm không còn phản ánh các tiêu chí độc lập.
- **Cách sửa nhỏ nhất:** Từ chối barem trùng/thiếu criterionId, điểm tối đa không hữu hạn/không hợp lệ và tổng thang điểm không nhất quán. Nút thêm tiêu chí phải sinh mã chưa có.
- **Sau khi sửa:** Barem trùng bị từ chối trước AI; barem hợp lệ và các ca SCORE-* hiện đạt vẫn giữ nguyên kết quả.
- **Ca độc lập:** `R19-02-duplicate-rubric`; trạng thái **OPEN**.

### R19-03 — P2 — Hash cũ chỉ của nhận xét vẫn được coi là toàn vẹn bài chấm

- **Phạm vi / vị trí:** TASK-5.3 / TASK-5.4; [src/lib/db/sqlite.ts:701-705](../../../src/lib/db/sqlite.ts#L701), [src/lib/db/sqlite.ts:758-779](../../../src/lib/db/sqlite.ts#L758).
- **Nguyên nhân:** verifyHomeworkContentIntegrity chấp nhận cả hash tổng hợp lẫn hash chỉ của feedbackHtml. Một số nhánh hạ trạng thái cũng ghi hash chỉ của nhận xét.
- **Tái hiện và kết quả:** Bản ghi có hash của nhận xét, đổi điểm thành 99 và quyết định REDO vẫn được hàm xác minh trả true.
- **Ảnh hưởng:** Không thể dùng kết quả true này để chứng minh điểm, quyết định và fileHash đã được duyệt. Ca tái hiện kiểm tra hợp đồng của hàm; chưa chứng minh API hiện tại tạo APPROVED bằng hash cũ.
- **Cách sửa nhỏ nhất:** Chỉ chấp nhận hash tổng hợp khi lưu LMS. Với dữ liệu hash cũ, hạ về chờ duyệt và yêu cầu duyệt lại; không tự nâng độ tin cậy.
- **Sau khi sửa:** Đổi bất kỳ trường được duyệt nào phải làm xác minh thất bại; dữ liệu cũ vẫn có đường duyệt lại an toàn.
- **Ca độc lập:** `R19-03-legacy-hash`; trạng thái **OPEN**.

### R19-12 — P2 — Danh sách buổi cũ có thể ghi đè buổi vừa chọn

- **Phạm vi / vị trí:** TASK-5.5; [src/components/homework-auto-grader-tab.tsx:183-203](../../../src/components/homework-auto-grader-tab.tsx#L183).
- **Nguyên nhân:** loadSessionSubmissions không gắn mã phiên tải hoặc hủy yêu cầu cũ; mọi phản hồi đến sau đều được setSubmissions.
- **Tái hiện và kết quả:** Giữ phản hồi Buổi 1, chuyển sang Buổi 2 và nhận danh sách Buổi 2 trước, rồi cho Buổi 1 trả về. selectedSessionNumber=2 nhưng danh sách hiện _SESS_01.
- **Ảnh hưởng:** Giáo viên xem nhầm danh sách; API có kiểm tra phạm vi vẫn có thể từ chối thao tác sau đó, nên ca này chưa chứng minh ghi sai lớp/buổi trực tiếp.
- **Cách sửa nhỏ nhất:** Hủy hoặc bỏ qua phản hồi không còn khớp lớp/buổi/lesson/phiên tải đang chọn. Xóa dữ liệu cũ khi đổi phạm vi và khóa thao tác trong lúc tải.
- **Sau khi sửa:** Phản hồi Buổi 1 đến muộn không đổi danh sách Buổi 2; áp dụng tương tự khi đổi lớp.
- **Ca độc lập:** `R19-12-ui-load-race`; trạng thái **OPEN**.

### R19-13 — P2 — Lưu nháp thất bại nhưng giao diện không báo

- **Phạm vi / vị trí:** TASK-5.5; [src/components/homework-auto-grader-tab.tsx:292-352](../../../src/components/homework-auto-grader-tab.tsx#L292).
- **Nguyên nhân:** Hai hàm sửa điểm/nhận xét cập nhật giao diện trước rồi gọi fetch, không kiểm tra HTTP hoặc success và không quản lý trạng thái chưa lưu.
- **Tái hiện và kết quả:** API giả trả HTTP 500, success=false, lỗi Synthetic disk full. UI vẫn hiển thị UNSAVED và banner=null.
- **Ảnh hưởng:** Giáo viên tưởng đã lưu nhưng có thể mất sửa khi làm mới; thứ tự phản hồi cũng chưa được khóa.
- **Cách sửa nhỏ nhất:** Kiểm tra kết quả lưu, thông báo lỗi rõ, giữ bản nhập chưa lưu và chặn duyệt/lưu LMS đến khi lưu nháp thành công. Kết hợp cơ chế phiên bản với R19-06.
- **Sau khi sửa:** Ca HTTP 500 có thông báo lỗi; sửa chưa lưu không bị mất và không được duyệt ngầm.
- **Ca độc lập:** `R19-13-ui-save-failure`; trạng thái **OPEN**.

## 7. Giới hạn của bằng chứng

- Không đăng nhập, tải, ghi điểm/nhận xét hoặc dùng tên/tệp học viên thật; không gọi LMS/Gemini thật và không có phát sinh chi phí model.
- Ca worker/downloader dùng cấu trúc DOM/API giả. Chúng chứng minh đường đi của hàm với đầu vào cụ thể; không khẳng định selector hiện đang khớp website thật hoặc tên GraphQL mutation thật. Bản sửa phải xác nhận đúng mutation bằng bằng chứng được cho phép ở vòng nghiệm thu sau.
- Ca UI chạy nguyên handler với bộ mô phỏng hook xác định được thứ tự phản hồi; chưa chạy UI trong Chromium, chưa kiểm tra hình thức, bàn phím, responsive hoặc cơ chế concurrent rendering đầy đủ của React.
- Scrub đã chứng minh cho tên văn bản tổng hợp; inlineData được gửi nguyên bytes, chưa chứng minh ẩn danh được tên nằm bên trong hình ảnh/PDF hoặc các biến thể tên trong mọi tệp thật. Sandbox/prompt không chứng minh Gemini thực tế sẽ miễn nhiễm mọi prompt injection.
- Không gây Zip Bomb cạn bộ nhớ thực; không thực thi code học viên; không thử tải lớn/treo tiến trình có chủ ý. Bằng chứng giới hạn kích thước gồm kiểm tra khai báo và nhánh an toàn, không thay thế kiểm tra giải nén đối kháng mọi biến thể.
- Không thử mất mạng/mất điện thật, hồ sơ đăng nhập thật, đồng thời nhiều tiến trình hoặc các Giai đoạn 6–7.

## 8. Quyết định và công việc tiếp theo

**NO-GO cấp mã nguồn cho Giai đoạn 5.** Ba điều kiện nghiệm thu trong kế hoạch đều còn chặn: định danh không bảo đảm (R19-07/08), điểm thành phần/nguồn bài chưa khóa đầy đủ (R19-02/04/05), xác nhận lưu chưa khớp toàn bộ bản duyệt (R19-09/10/11). Các kiểm tra cũ 186/186 đạt không khắc phục các lỗi mới này.

Thứ tự sửa phù hợp: (1) R19-07/08/09/10/11 để bảo vệ người/bài và kết quả LMS; (2) R19-01/04/05/06/14 để khóa nguồn bài và phê duyệt; (3) R19-02/03/12/13 để hoàn thiện kiểm toán và phản hồi giao diện. Khi sửa cần giữ các ca hiện đạt, chuyển đủ 20 ca lỗi thành đạt, rồi chạy lại toàn bộ 9 lệnh trong bản sao cô lập và cập nhật vòng kiểm chứng mới. Sau đó mới có thể đánh giá GO cấp mã nguồn; nghiệm thu với dịch vụ thật là bước riêng cần phạm vi được Owner cho phép.

Owner không cần chạy Terminal hoặc cung cấp tài khoản trong vòng này. Đã chuẩn bị [FIX_PROMPT.vi.md](FIX_PROMPT.vi.md) để giao tác nhân sửa theo đúng phạm vi; báo cáo này không tự cấp phép sửa hay thao tác dữ liệu thật.

## 9. Hồ sơ bàn giao

- [verify-independent.mjs](verify-independent.mjs): bộ ca độc lập R19; chạy nguyên lệnh yêu cầu, tự cô lập dữ liệu giả.
- [run-checks.mjs](run-checks.mjs): tạo snapshot, chạy lệnh và kiểm tra bảo toàn; không ghi đè baseline đã có.
- [commands.json](commands.json), các file .log và kết quả từng vòng: lịch sử chạy đầy đủ.
- [independent-results.json](independent-results.json), [issue-status.json](issue-status.json): kết quả cuối và ánh xạ 20 ca trượt → 14 nhóm lỗi.
- [source-state.json](source-state.json), [snapshot-check.json](snapshot-check.json), [preservation-check.json](preservation-check.json), [review-scope.json](review-scope.json), [evidence-manifest.json](evidence-manifest.json): phiên bản, phạm vi và hash bằng chứng.

**Đã làm:** rà soát TASK-5.1…5.5, tạo bộ kiểm tra độc lập, chạy đủ lệnh và cập nhật AUDIT-R19.

**Kết quả:** NO-GO Giai đoạn 5; 74/94 ca độc lập mới đạt, 20 ca trượt/14 nhóm; 186/186 nhóm cũ đạt; build và TypeScript đạt.

**Chưa kiểm tra:** dịch vụ/tài khoản/dữ liệu thật và UI trình duyệt như giới hạn nêu trên.

**Việc tiếp theo:** giao sửa các nhóm lỗi rồi kiểm chứng lại; chưa dùng chức năng lưu điểm tự động với dữ liệu thật.
