# Kiểm định độc lập S4 — v3.4.0 — Round 3

**VERDICT: GO**

**Ngày:** 2026-10-30, múi giờ `Asia/Saigon`.  
**Mốc mã:** `930132f04e7f4fe411f2c3c9df58305d7a7fa51b` **cộng cây làm việc S4 chưa commit** được nhận diện bằng [protected-before.json](s4-round3/protected-before.json) và [working-tree.patch](s4-round3/working-tree.patch). GO không áp dụng cho riêng commit HEAD.  
**Vai trò:** Auditor độc lập theo yêu cầu; trực tiếp đọc mã, chạy kiểm tra và ghi báo cáo; không sửa mã ứng dụng hoặc kiểm thử sản phẩm.  
**Phát hiện cũ:** **6/6 CLOSED**, gồm `S4-01`, `S4-02`, `S4-03`, `S4-R2-01`, `S4-R2-02`, `S4-R2-03`.  
**Phát hiện còn mở được xác nhận trong phạm vi kiểm định:** **0 CRITICAL / 0 HIGH / 0 MEDIUM / 0 LOW**.

Bản sửa hiện phát hiện đúng điểm Buổi 14 thay đổi trong khi quét, kể cả điểm Demo chuyển về 0 và hai học sinh trùng tên có nguồn đánh giá khác nhau. Các bản chờ duyệt chưa có điểm có hiệu lực và bản đánh giá theo mã CRM không còn gây cảnh báo sai trong các tình huống hai vòng trước. Sáu lệnh bắt buộc đều đạt; probe đối kháng mới kiểm tra thêm thứ tự chọn nguồn, trạng thái đánh giá, dữ liệu Lập trình/Robotics, xuất file và phản hồi giao diện lỗi.

GO này dành cho **cổng kiểm định mã và hành vi cục bộ của S4**, không phải chứng nhận phát hành toàn bộ v3.4.0, nghiệm thu thao tác trên trình duyệt thật hoặc nghiệm thu tài khoản LMS/Teaching thật.

## 1. Phạm vi, nguồn đối chiếu và an toàn

Đã đọc `PROJECT_STATE.md` trước khi điều tra sâu; đối chiếu `MINDX_AUTOMATION_PLAN.md`, `CHANGELOG.md`, [Round 1](CODEX_S4_ROUND1.md), [Round 2](CODEX_S4_ROUND2.md), trạng thái Git và mã hiện tại. Không lấy kết luận lịch sử làm kết quả chạy mới. Giả định sử dụng: ứng dụng cục bộ của giáo viên; có thể đổi lớp, nhận phản hồi muộn hoặc lưu đánh giá trong lúc quét; không giả định nhiều máy chủ.

| Tệp được yêu cầu | Nội dung kiểm tra |
|---|---|
| `src/lib/report-card/report-card-calculator.ts` | `crmStudentId?: string` trong kiểu học sinh của snapshot; tác động đến tính điểm. |
| `src/lib/playwright/scrape-scores.ts` | Dựng danh sách học sinh, thứ tự chọn đánh giá Buổi 14, điều kiện có hiệu lực, làm tròn/giới hạn điểm; bảo toàn CRM ở dòng 2437. |
| `src/app/api/report-card/route.ts` | GET, POST, PUT; `hasEvaluatedSession14Record`, đối chiếu theo từng học sinh, các mã định danh, tên/slug, thời gian và nội dung điểm, thiếu CP, helper approve chung. |
| `src/components/teaching-report-card-view.tsx` | Luồng duyệt rồi đồng bộ, khóa phiên bản, lỗi/409, đổi lớp, phản hồi cũ, giải phóng trạng thái đang xử lý, cảnh báo và nút quét. |
| `src/app/homework-grader/page.tsx` | Phiếu điểm chính, chi tiết bài nộp thu gọn, quét qua component con, cache/đổi lớp, TSV và xuất file. |
| `src/app/api/homework-grader/scores/route.ts` | Helper đưa thao tác quét vào hàng đợi, GET cache sau khi bỏ trường thừa, POST và kiểm tra yêu cầu cục bộ. |
| `src/app/api/homework-grader/export/route.ts` | Helper chung, CSV/XLSX, giữ điểm 0, tên/cột có dạng công thức. |
| `src/lib/report-card/export-cell-formatter.ts` | Trạng thái bài nộp, ba chế độ xuất, xử lý công thức và tương thích harness cũ. |
| `scripts/test-streamline-v340-s4.ts` | Cách ly dữ liệu, S4-T1..T5 và các ca bổ sung cho lỗi Round 2. |

Đã lần theo các phần kết nối cần thiết trong SQLite (`session14EvalRepo`, `reportCardRepo`, lưu/đọc snapshot), route `sync-teaching`, dịch vụ đồng bộ Teaching, danh sách lớp, bảo vệ request cục bộ và hàng đợi. Đọc thêm thay đổi import helper trong `src/lib/zalo/broadcast-generator.ts`; không sửa tệp này.

### Bảo vệ dữ liệu và tệp có sẵn

- **Không mở, đọc, băm, sao chép hoặc sửa** `data/mindx_bot.db` và `data/running_classes.json`. Không đưa ra số băm mới hoặc tuyên bố đã so byte hai tệp dữ liệu vận hành.
- Trước khi import mã ứng dụng, mọi tiến trình kiểm thử/probe đều có `MINDX_DB_PATH`, `MINDX_RUNNING_CLASSES_PATH`, `ALLOWED_LOCAL_DIRS` trỏ vào thư mục tạm dưới TEMP. Bộ S4/v330 tiếp tục tạo thư mục dữ liệu con tạm như thiết kế; probe bổ sung tự cấp ba biến này trước khi nạp SQLite/route.
- Sáu lệnh bắt buộc dùng các DB/cache riêng theo từng lệnh. Giá trị thực tế được lưu trong [gates.json](s4-round3/gates.json), thư mục cha trong [environment.json](s4-round3/environment.json). Tên học sinh và dữ liệu thử đều là giả.
- Không khởi động server ứng dụng, đăng nhập, dùng hồ sơ trình duyệt Owner, quét LMS, gửi điểm Teaching, gọi Gemini, commit hoặc push. Request route trong probe là `Request` cục bộ được gọi trực tiếp vào handler; các nhánh đồng bộ thành công dùng mô phỏng trong bộ hồi quy/harness.
- Trước kiểm tra đã ghi dấu vân tay **162 tệp có sẵn**, gồm **107 tệp `src/`, 19 tệp `scripts/`**, cấu hình/tài liệu liên quan và toàn bộ bằng chứng S4 Round 1/2. Sau sáu lệnh: **162/162 giữ nguyên hash, kích thước và thời gian sửa**, xem [protected-verification.json](s4-round3/protected-verification.json). Kiểm tra cuối toàn phiên nằm ở [final-verification.json](s4-round3/final-verification.json).
- `tsc` chạy với `--incremental false`; `tsconfig.tsbuildinfo` nằm trong danh sách bảo vệ. Không cần ghi đè phục hồi.
- Chỉ thêm hồ sơ Round 3 dưới `docs/audits/v340/` và bổ sung ghi nhận kiểm định ngắn vào `PROJECT_STATE.md`, `CHANGELOG.md`, `MINDX_AUTOMATION_PLAN.md` theo quy định cập nhật tài liệu của dự án. Ba tài liệu này đã được sao lưu vào TEMP trước khi chỉnh; không tự đổi các ô nghiệm thu triển khai sang hoàn tất.

## 2. Sáu lệnh bắt buộc — chạy mới

Môi trường: Windows/PowerShell, Node `v24.21.0`, múi giờ `Asia/Saigon`; TypeScript/tsx đã cài trong dự án. Chạy từ thư mục gốc dự án bằng `npx` với các thư viện sẵn có; không cài thêm.

| Lệnh | Exit | Kết quả | Bằng chứng |
|---|---:|---|---|
| `node --require tsx/cjs docs/audits/v340/s4-round2/closure-probe.cjs` | 0 | **25/25 bản ghi PASS**: lỗi gốc và kiểm soát hồi quy. | [closure.log](s4-round3/closure.log), [closure-results.json](s4-round3/closure-results.json) |
| `node --require tsx/cjs docs/audits/v340/s4-round2/parity-probe.cjs` | 0 | **14 bản ghi: 8 PASS, 6 CLOSED, 0 OPEN**. | [parity.log](s4-round3/parity.log), [parity-results.json](s4-round3/parity-results.json) |
| `npx tsc --noEmit --incremental false` | 0 | PASS; không có lỗi kiểu dữ liệu. | [tsc.log](s4-round3/tsc.log) |
| `npx tsx scripts/test-streamline-v340-s4.ts` | 0 | PASS **S4-T1..S4-T5**, gồm các ca sửa Round 2 trong T5. | [s4.log](s4-round3/s4.log) |
| `npx tsx scripts/test-report-card-v330.ts` | 0 | PASS **RC-01..RC-06**, gồm tính điểm, khóa nội dung/phiên bản, đồng bộ mô phỏng và hành vi giao diện. | [v330.log](s4-round3/v330.log) |
| `npx tsx scripts/test-phase4-codex-repros.ts` | 0 | PASS toàn bộ các nhóm mà script hiện chạy, log tổng kết Round 1..17. | [phase4.log](s4-round3/phase4.log) |

**Đã đọc kết quả nghiệp vụ, không chỉ mã thoát.** `parity-probe` vốn có thể thoát 0 khi còn `OPEN`; lần này sáu quan sát từng tái hiện lỗi đều là `CLOSED`. Hai probe Round 2 được chạy nguyên bản, không sửa assertion hoặc bằng chứng lịch sử. Chúng ghi kết quả mới vào đường dẫn TEMP cố định của probe; runner sao chép kết quả vào thư mục Round 3, không ghi đè hồ sơ Round 2 trong repo.

Các số trên là số bản ghi/nhóm; không cộng chúng thành tổng số assertion. Một bản ghi có thể chứa nhiều phép thử, ví dụ `TIME-MATRIX` chứa 12 chuyển điểm và `C-formatter` chứa 29 đối chiếu. Thông báo dotenv và cảnh báo thử nghiệm `stripTypeScriptTypes` không phải lỗi kiểm thử.

## 3. Kết luận từng phát hiện cũ

| Phát hiện | Trạng thái Round 3 | Bằng chứng và lý do đóng |
|---|---|---|
| **S4-01 — HIGH** | **CLOSED**, bao gồm phần định danh từng còn mở ở Round 2. | Closure `P02`, `P03`: nguồn đổi 4 → 5 trong khoảng quét, trước giờ hoàn tất, nay được cảnh báo cả qua approve thật. Parity `R2-01-PURE/API` nhận đúng điểm cũ của bạn thứ hai; fresh-control hết cảnh báo. Probe mới A01/A07 kiểm thêm nguồn ưu tiên và nguồn bị che bởi nguồn ưu tiên cao hơn. |
| **S4-02 — MEDIUM** | **CLOSED**. | Closure `P04`, `P05`, parity `TIME-MATRIX`: nhận biết 4 → 0, 0 → 4, 4 → 5; không báo 4 → 4; giờ ISO/SQLite cục bộ và thay đổi trước giờ hoàn tất. A02/A03 xác nhận điểm 0 có hiệu lực, giữ 0 qua lưu/đọc và route CRM thật. |
| **S4-03 — LOW** | **CLOSED**. | S4-T2/T5 và closure `P06`: tiêu đề riêng cho chỉ Buổi 14 mới, chỉ thiếu CP và đồng thời cả hai; nhánh chỉ thiếu CP không nói sai là có Buổi 14 mới. |
| **S4-R2-01 — HIGH** | **CLOSED**. | Probe gốc dựng hai học sinh khác mã nhưng trùng tên: snapshot cũ **[5,4]**, nguồn hiệu lực hiện tại **[5,5]**. Hàm thật, GET thật và POST approve thật đều trả cảnh báo; snapshot mới **[5,5]** hết cảnh báo. Không còn gán slug chung vào bạn đầu tiên rồi bỏ qua bạn thứ hai. |
| **S4-R2-02 — LOW** | **CLOSED**. | `R2-02-RESCAN-1/2`: gọi `saveDraft` thật chỉ có góp ý, `WAITING_APPROVAL`, Demo 0 mặc định, thư rỗng; hai snapshot mới dùng điểm LMS 4 đều không bị báo cũ. A02 kiểm thêm 144 tổ hợp trạng thái/điểm/nội dung thư/loại lớp. |
| **S4-R2-03 — LOW** | **CLOSED**. | `R2-03-RESCAN-1/2`: mã chuẩn, CRM và UID khác nhau nhưng hai snapshot mới cùng điểm không còn báo cũ. A03 xác nhận CRM được giữ qua SQLite/GET; sửa nguồn CRM 4 → 0 được nhận biết cả POST/PUT approve; quét mới điểm 0 thì cảnh báo hết. |

**Điểm cần đọc đúng:** approve của một phiếu có cảnh báo vẫn có thể trả HTTP 200 và khóa nội dung. Yêu cầu S4 hiện là **cảnh báo dữ liệu cũ**, không quy định bắt buộc cấm duyệt mọi phiếu có `isStale=true`. Vì vậy HTTP 200 không tự nó làm finding còn mở; điều kiện đóng là cảnh báo đúng, không bỏ sót và không cảnh báo vô hạn sau quét lại. Không thực hiện đồng bộ thật trong các ca này.

## 4. Probe đối kháng Round 3

Lệnh bổ sung chạy thành công, exit 0:

```text
node --require tsx/cjs docs/audits/v340/s4-round3/adversarial-probe.cjs
```

Mã và bằng chứng: [adversarial-probe.cjs](s4-round3/adversarial-probe.cjs), [adversarial.log](s4-round3/adversarial.log), [adversarial-results.json](s4-round3/adversarial-results.json), [adversarial-run.json](s4-round3/adversarial-run.json).

| Nhóm | Cách thử | Kết quả |
|---|---|---|
| **R3-A01** | Hai học sinh tên khác nhau/trùng tên, 15 tổ hợp nguồn mỗi kiểu; dùng bộ dựng snapshot thật. Sửa từng nguồn về 0 hoặc 5 trong khoảng trước khi quét hoàn tất; so với snapshot dựng lại từ nguồn hiện tại. | **30 snapshot mới không báo sai; 88 thay đổi nguồn có hiệu lực được phát hiện; 40 sửa nguồn không được chọn không gây cảnh báo.** Snapshot dựng lại đều hết cảnh báo. |
| **R3-A02** | Lập trình/Robotics × 6 trạng thái × 6 điểm (0; 0.004; 0.005; 3.337; 5; 6) × thư rỗng/có nội dung. Kiểm điều kiện hiệu lực, giới hạn 0..5, làm tròn và bảo toàn CRM khi lưu/đọc. | **144/144 tổ hợp đạt; 144 lượt lưu/đọc CRM giữ nguyên**. Không biến Demo 0 mặc định thành điểm mới khi bản ghi chưa có hiệu lực. |
| **R3-A03** | Mã chuẩn `CANON`, CRM `CRM_EXT`, UID `UID_EXT`; thay đổi CRM về 0; GET/POST/PUT thật trên SQLite tạm; approve sai phiên bản; quét lại. | CRM được giữ; GET và hai cách approve cảnh báo đúng; phiên bản sai **409**; quét lại đúng điểm xóa cảnh báo. |
| **R3-A04** | Gọi route export thật, đọc lại workbook/CSV bằng XLSX: 2 định dạng × 3 chế độ × 5 ô trạng thái; mã/tên/cột có tiền tố công thức. | **6 file / 30 ô điểm đạt**; giữ điểm và trung bình 0; trường dạng công thức được vô hiệu hóa; không tạo ô công thức XLSX. |
| **R3-A05** | Harness component: JSON lỗi ở approve, JSON lỗi ở sync, approve trả nhầm lớp. | **3/3 đạt**; không đi tiếp sync sau approve lỗi/sai lớp; không báo thành công giả; giải phóng các cờ đang xử lý. |
| **R3-A06** | Component độc lập không có callback quét từ trang cha; một POST quét thành công rồi tải phiếu. | **1 POST**, ngoài GET ban đầu chỉ có **1 GET tải lại**; kết thúc trạng thái quét đúng. Không suy diễn số request này thành số request toàn trang trên trình duyệt thật. |
| **R3-A07** | Giữ **mã chuẩn/CRM/UID khác nhau**, thêm slug; 15 tổ hợp nguồn đồng thời; sửa lần lượt mỗi nguồn. | **32 lần sửa đạt**: 15 thay đổi nguồn hiệu lực được phát hiện, 17 thay đổi nguồn phụ không báo sai; mọi bản quét mới đều hết cảnh báo. |
| **R3-A08** | Cố nối CRM sang mã chuẩn chỉ bằng tên khi danh sách cục bộ có hai mã cùng tên và không có mã trực tiếp để phân biệt. | Bộ dựng **từ chối vì xung đột định danh** trước khi tạo snapshot; không tự ghép tùy ý. |

Oracle của A01/A07 là chênh lệch điểm Demo/Năng lực giữa hai snapshot do **bộ dựng thật** tạo từ hai phiên bản nguồn; không chỉ lặp lại bảng ánh xạ của guard để tự chứng minh guard đúng. Các nhóm có phạm vi chồng nhau; không cộng thành một tổng ca kiểm thử duy nhất.

Trong lúc xây dựng probe có hai lần dừng ở dữ liệu thử: lần đầu ô ma trận thiếu `columnId`/`maxScore`; lần sau thử một cầu nối tên bị bộ dựng từ chối do mơ hồ. Đã chỉnh **chỉ probe kiểm định** để cấp đủ ô hợp lệ và tách trường hợp mơ hồ thành A08 kỳ vọng từ chối. Lưu các kết quả trung gian tại [adversarial-attempt1.json](s4-round3/adversarial-attempt1.json), [adversarial-attempt2.json](s4-round3/adversarial-attempt2.json). Kết quả cuối của tám nhóm đều PASS; hai lần chuẩn bị fixture không được báo thành lỗi ứng dụng.

## 5. Đối chiếu phạm vi S4.1–S4.7

`MINDX_AUTOMATION_PLAN.md` hiện liệt kê **checklist gộp S4.1–S4.7** tại phần Chặng S4, không tách mô tả cho từng số. Bảng này đối chiếu nội dung checklist, không tự đặt lại định nghĩa từng mã con.

| Nội dung S4 | Kết luận trong phạm vi kiểm định |
|---|---|
| Giữ một đường quét điểm chính | Nút quét trùng ở Hero đã bỏ; component dùng callback trang cha hoặc route scores chung; route report-card tương thích cũng gọi helper hàng đợi chung. Nút `Quét lại` của banner là lối gọi cùng handler, không phải đường quét độc lập. |
| Gộp duyệt và đồng bộ Teaching | Một handler gọi approve trước, chỉ gọi sync sau phản hồi hợp lệ/đúng lớp/phiên bản; giữ nút chỉ duyệt và thử lại. S4-T1, closure và A05 xác nhận các nhánh thành công mô phỏng, xung đột và lỗi. |
| Cảnh báo bản quét cũ/thiếu CP | Sáu finding cũ đóng; đối kháng chọn nguồn/điểm 0/status/CRM đạt. Điểm CP 0 được coi là có; học sinh không hoạt động không làm ca đủ CP bị báo thiếu. |
| Phiếu điểm chính và ma trận thu gọn | Phiếu điểm luôn được render; chi tiết bài nộp dùng `showSubmissionDetails`, mặc định false; nút xuất/đổi chế độ/xem nhận xét vẫn có trong mục mở rộng. Xác nhận mã/harness, chưa nghiệm thu bố cục bằng trình duyệt thật. |
| Một hàm định dạng TSV/Excel/CSV | Trang và route dùng helper chung; kiểm thử hồi quy TSV và export thật sáu file đạt, giữ 0/trạng thái/chống công thức. `sanitizeTsvCell` vẫn xử lý tab/xuống dòng trước khi ghép TSV. |
| Bỏ tải lại/khối thừa | `scrapeTrigger=""` tránh tải lại phiếu chỉ vì cache ma trận vừa trả về; GET scores bỏ sessions/students/rubrics; đã bỏ các khối chết được chỉ định. Xác nhận mã và test; chưa đo lưu lượng toàn trang thật. |
| Bộ kiểm thử và kiểm định độc lập | S4-T1..T5, hai probe gốc, TypeScript và hai bộ hồi quy đạt; tám nhóm đối kháng mới đạt; **GO trong phạm vi cục bộ**. |

Các bảo vệ giữ nguyên qua closure/hồi quy: approve lỗi 400/409/500 hoặc mất mạng không sync; đổi lớp và phản hồi cũ không báo thành công nhầm; sync sai phiên bản/hash bị từ chối; bảy handler từ chối request không cục bộ bằng 403. Thao tác quét vẫn đi qua hàng đợi tuần tự; thay đổi S4 không tạo BrowserContext mới.

Hai giới hạn thiết kế có sẵn được giữ đúng khi đánh giá: cảnh báo thiếu CP chỉ bật khi **toàn bộ học sinh đang học thiếu mọi thành phần** của checkpoint đó, không phải kiểm tra từng ô trống; các biến toàn cục nạp helper xuất điểm vẫn phục vụ harness Phase 4 cũ. Không có tình huống lỗi mới mức CRITICAL/HIGH/MEDIUM được chứng minh từ các phần này trong lần kiểm định này.

## 6. Giới hạn và bước tiếp theo

**Chưa kiểm tra:**

- `next build`, khởi động bản phát hành và khả năng đóng gói toàn ứng dụng.
- Chuột/bàn phím, số click thực tế 4 → 2, số request toàn trang, clipboard/ảnh và bố cục trên trình duyệt thật. Đường thao tác hai bước được xác nhận bằng mã và harness: Quét → Duyệt & Đồng bộ.
- Quét LMS thật, HTTP nghiệp vụ thật, đẩy điểm và đọc lại sau ghi trên tài khoản Teaching thật. Mô phỏng đạt không được coi là đã nghiệm thu dịch vụ ngoài.
- Toàn bộ các chặng khác và toàn bộ v3.4.0.

Không còn yêu cầu sửa mã để đóng sáu finding được giao. Có thể dùng báo cáo này để đóng cổng kiểm định S4 cục bộ và tiếp tục chặng kế tiếp theo kế hoạch; việc nghiệm thu thao tác thực tế cần ghi thành bằng chứng riêng khi thực hiện. Owner không cần nhập tài khoản hoặc thao tác dữ liệu thật cho lần kiểm định này.

Hồ sơ có thể tái chạy bằng `node docs/audits/v340/s4-round3/run-gates.cjs` (runner tự cấp ba biến dữ liệu TEMP) và lệnh probe bổ sung ở mục 4. Mọi kết luận sau khi mã thay đổi cần gắn với dấu vân tay mới; không tái sử dụng GO này cho một cây mã khác.

**VERDICT CUỐI: GO — 6/6 phát hiện cũ CLOSED; không còn CRITICAL, HIGH hoặc MEDIUM được xác nhận trong phạm vi Stage S4 đã kiểm định. Không sửa `src/**`, `scripts/**` hoặc dữ liệu vận hành thật.**
