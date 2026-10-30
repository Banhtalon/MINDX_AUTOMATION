# Kiểm định độc lập S4 — v3.4.0 — Round 2

**VERDICT: NO-GO**

**Ngày:** 2026-10-30, `Asia/Saigon`.  
**Mốc mã:** `930132f04e7f4fe411f2c3c9df58305d7a7fa51b` **cộng các thay đổi S4 chưa commit**. Kết luận gắn với dấu vân tay tệp trong hồ sơ vòng này, không phải riêng HEAD.  
**Vai trò:** Auditor độc lập theo yêu cầu; trực tiếp kiểm tra, không sửa mã ứng dụng.  
**Phát hiện bổ sung còn mở:** **0 CRITICAL / 1 HIGH / 0 MEDIUM / 2 LOW**. S4 chưa đủ điều kiện GO vì còn HIGH.

Bản sửa đã khắc phục các tình huống thời gian, điểm Demo 0 và tiêu đề cảnh báo được tái hiện trong vòng 1. Cả bốn kiểm tra chính đều đạt. Tuy nhiên, cách ghép đánh giá Buổi 14 với học sinh **chưa tương đương bộ quét**: với hai học sinh trùng tên nhưng khác mã, hệ thống có thể kiểm tra nhầm bạn và bỏ sót điểm cũ. Đã xác nhận bằng bộ dựng snapshot thật, SQLite tạm và GET/POST approve thật: phiếu còn điểm **4 thay vì 5** vẫn được duyệt HTTP 200, có khóa nội dung và **không có cảnh báo**.

## 1. Phạm vi, nguồn đối chiếu và bảo vệ dữ liệu

Đã đọc `PROJECT_STATE.md` trước, đối chiếu `MINDX_AUTOMATION_PLAN.md`, `CHANGELOG.md`, báo cáo Round 1, trạng thái Git và các đường gọi liên quan. Những kết luận lịch sử trong tài liệu dự án không được tính là kết quả chạy mới của vòng này.

| Tệp S4 thay đổi/mới đã kiểm tra | Nội dung đối chiếu |
|---|---|
| `src/lib/report-card/export-cell-formatter.ts` | Ba chế độ xuất, các trạng thái bài nộp, điểm 0, chống công thức bảng tính và tác dụng phụ khi import. |
| `src/app/api/homework-grader/export/route.ts` | Helper dùng chung, CSV/XLSX, kiểm tra yêu cầu cục bộ. |
| `src/app/api/homework-grader/scores/route.ts` | Helper đưa việc quét vào hàng đợi; GET sau khi bỏ sessions/students/rubrics; các nơi gọi. |
| `src/app/api/report-card/route.ts` | Toàn bộ thay đổi S4, GET/POST/PUT, kiểm tra thời gian/nội dung/định danh, helper approve dùng chung và phiên bản. |
| `src/components/teaching-report-card-view.tsx` | Duyệt rồi đồng bộ, lỗi/409, phản hồi đến muộn, đổi lớp, cờ đang xử lý, ba tiêu đề cảnh báo. |
| `src/app/homework-grader/page.tsx` | Nút quét dùng qua component con, tải cache, Phiếu điểm luôn hiện, mục bài nộp thu gọn, TSV và xuất file. |
| `src/lib/zalo/broadcast-generator.ts` | Import helper để tương thích bộ kiểm thử VM Phase 4. |
| `scripts/test-streamline-v340-s4.ts` | Cách ly DB/cache, S4-T1..T5, harness component và khoảng trống kiểm thử định danh. |

Đã lần theo mã kết nối trong `sqlite.ts`, `scrape-scores.ts`, `report-card-calculator.ts`, `teaching-report-card-sync.ts`, route `sync-teaching`, `local-guard.ts`, `task-queue.ts`, route `spck/session14-eval` và luồng đồng bộ danh sách lớp. Giả định sử dụng: ứng dụng cục bộ của giáo viên, có thể đổi lớp, mở nhiều tab hoặc lưu đánh giá trong lúc quét.

Tất cả tiến trình chạy kiểm thử/probe được cấp các biến sau **trước khi import mã ứng dụng**:

```powershell
$env:ALLOWED_LOCAL_DIRS=$env:TEMP
$env:MINDX_DB_PATH="$env:TEMP\codex_s4_r2.db"
$env:MINDX_RUNNING_CLASSES_PATH="$env:TEMP\codex_s4_r2_rc.json"
```

- Bộ S4 tự tạo DB/cache con ngẫu nhiên dưới TEMP; bộ v330 cũng tạo DB/cache con dưới thư mục TEMP được cấp. Đã đọc phần khởi tạo để xác nhận. Phase 4 và hai probe dùng đường dẫn tạm từ bên ngoài.
- Hai probe xác nhận đường dẫn DB/cache nằm trong TEMP trước khi import SQLite hoặc route.
- **Không mở, đọc, băm, sao chép hoặc sửa** `data/mindx_bot.db` và `data/running_classes.json`. Không đưa ra số băm mới hay tuyên bố đã so byte dữ liệu vận hành.
- Không khởi động server, đăng nhập, dùng trình duyệt Owner, gọi LMS/Teaching/Gemini thật, commit hoặc push. Các request trong probe gọi trực tiếp handler với `Request` giả cục bộ.
- Các ca kiểm tra route sync thật dừng ở lỗi phiên bản/hash trước phần truy cập dịch vụ ngoài. Các ca component dùng fetch mô phỏng.
- `tsconfig.tsbuildinfo` được sao lưu vào TEMP; TypeScript chạy với `--incremental false`. Đối chiếu cuối xác nhận **không đổi byte**, không cần ghi đè phục hồi.
- **145/145 tệp có sẵn được bảo vệ giữ nguyên SHA-256, độ dài và thời gian sửa cuối**, gồm mã dưới `src/`, kiểm thử dưới `scripts/`, tài liệu định hướng, cấu hình đã chọn và toàn bộ hồ sơ S4 Round 1. Không sửa ba tài liệu theo dõi triển khai hoặc tự đánh dấu S4 hoàn tất trong lần kiểm định này. Chỉ thêm báo cáo Round 2 và bằng chứng tại `s4-round2/`.

## 2. Kiểm tra đã chạy mới

Môi trường: Node `v24.21.0`, TypeScript `7.0.2`, Windows/PowerShell, múi giờ `Asia/Saigon`. Dùng công cụ đã cài trong dự án, không cài thêm thư viện.

| Lệnh tại thư mục gốc | Exit | Kết quả thực tế | Bằng chứng |
|---|---:|---|---|
| `.\node_modules\.bin\tsx.cmd scripts/test-streamline-v340-s4.ts` | 0 | PASS S4-T1..S4-T5 | [s4.log](s4-round2/s4.log) |
| `.\node_modules\.bin\tsx.cmd scripts/test-report-card-v330.ts` | 0 | PASS RC-01..RC-06, gồm các nhánh tương thích S4 cũ | [v330.log](s4-round2/v330.log) |
| `.\node_modules\.bin\tsx.cmd scripts/test-phase4-codex-repros.ts` | 0 | PASS toàn bộ nhóm tái hiện hiện có | [phase4.log](s4-round2/phase4.log) |
| `.\node_modules\.bin\tsc.cmd --noEmit --incremental false` | 0 | Không có lỗi TypeScript | [tsc.log](s4-round2/tsc.log) |
| `node --require tsx/cjs docs/audits/v340/s4-round2/closure-probe.cjs` | 0 | 25 bản ghi quan sát PASS: kỳ vọng đóng lỗi gốc và các ca kiểm soát | [closure.log](s4-round2/closure.log), [closure-results.json](s4-round2/closure-results.json) |
| `node --require tsx/cjs docs/audits/v340/s4-round2/parity-probe.cjs` | 0 | Thu thập đủ 14 bản ghi: **8 PASS, 6 OPEN**, gom thành 3 phát hiện bổ sung | [parity.log](s4-round2/parity.log), [parity-results.json](s4-round2/parity-results.json) |

**Không diễn giải exit 0 của parity-probe thành nghiệm thu đạt.** Probe này cố ý ghi nhận đủ các trường hợp lỗi rồi thoát bình thường; phải đọc trường `state`. Số bản ghi quan sát cũng không phải tổng số assertion. Ví dụ, một bản ghi TIME-MATRIX chứa 12 ca chuyển điểm.

`closure-probe.cjs` là **bản thích nghi riêng cho Round 2** từ probe vòng 1: đổi các assertion mô tả lỗi cũ sang kỳ vọng đã sửa, bổ sung nhãn `originalFinding`/`state`. Không chạy hoặc sửa probe lịch sử để thay đổi bằng chứng Round 1. HTTP 200 ở ca approve gốc hiện đi kèm cảnh báo đúng; cơ chế S4 đang là cảnh báo, không phải quy định bắt buộc từ chối mọi lần duyệt phiếu có `isStale=true`.

## 3. Trạng thái S4-01, S4-02 và S4-03

| Mã vòng 1 | Xác minh vòng 2 | Trạng thái |
|---|---|---|
| **S4-01 — HIGH** | Ca gốc đọc Demo 4 → sửa thành 5 trong lúc quét → hoàn tất sau lần sửa nay trả `hasNewerSession14=true`, kể cả qua route approve thật. Khi snapshot chứa 5, cảnh báo hết trong ca một học sinh không mơ hồ. Tuy nhiên, yêu cầu dùng cùng quy tắc ghép học sinh với scraper chưa đạt: xem S4-R2-01. | **Tình huống thời gian gốc CLOSED; phạm vi đầy đủ PARTIALLY FIXED / OPEN.** Không đếm trùng với HIGH S4-R2-01. |
| **S4-02 — MEDIUM** | Nhận biết `4 → 0`, `0 → 4`, `4 → 5`; không cảnh báo `4 → 4`; giờ ISO và SQLite cục bộ; DRAFT mặc định không gây cảnh báo. Có phép so sánh Năng lực thay đổi và mốc thời gian trước giờ hoàn tất quét. | **CLOSED cho lỗi loại bỏ Demo 0.** Các vấn đề chọn nguồn/định danh được ghi riêng bên dưới. |
| **S4-03 — LOW** | Chỉ Buổi 14 mới: tiêu đề Buổi 14; chỉ thiếu CP: tiêu đề Check-point; cả hai: tiêu đề nêu cả hai. S4-T2 kiểm tra nhánh chỉ Buổi 14, S4-T5 kiểm tra CP-only và cả hai; probe riêng kiểm lại CP-only. | **CLOSED.** |

## 4. Phát hiện HIGH còn chặn nghiệm thu

### S4-R2-01 — HIGH — Hai học sinh trùng tên khiến đối chiếu bỏ sót điểm cũ của bạn thứ hai

**Vị trí:** `src/app/api/report-card/route.ts:124–134`, `:147–169`.  
**Đối chiếu:** `src/lib/playwright/scrape-scores.ts:2210–2241`.  
**Bằng chứng:** `R2-01-PURE`, `R2-01-API`, `R2-01-FRESH-CONTROL` trong [parity-results.json](s4-round2/parity-results.json); mã tái hiện tại [parity-probe.cjs:89](s4-round2/parity-probe.cjs#L89).

**Nguyên nhân:** guard dựng bảng tra ngược, gắn mỗi mã tạo từ tên (`STU_<lớp>_<tên không dấu>`, gọi là slug) vào **học sinh đầu tiên** có tên đó. Sau đó mỗi bản đánh giá chỉ được đối chiếu với một học sinh. Scraper làm theo chiều ngược lại: với **từng học sinh**, ưu tiên mã riêng/CRM/UID, rồi tên và slug. Có cùng danh sách loại mã không có nghĩa là giữ đúng thứ tự chọn nguồn và quan hệ giữa các bản ghi.

**Tái hiện bằng mã thật và dữ liệu giả:**

1. Lớp có hai học sinh cùng tên `Nguyễn Văn An`, nhưng mã thật khác nhau: `CRM_A`/`UID_A` và `CRM_B`/`UID_B`. Danh sách SQLite có `CRM_A`, `CRM_B`; đây không phải một học sinh bị nhân đôi mã trong fixture.
2. Đánh giá riêng theo `UID_A` là Demo **5**. Đánh giá cũ theo slug tên là Demo **4**. Scraper chọn bản UID riêng cho A; B dùng bản slug. Bộ dựng snapshot thật tạo điểm **[5, 4]**.
3. Trong lúc quét, sửa bản slug thành **5** lúc `08:00:30Z`. Quét hoàn tất `08:01:00Z` nhưng vẫn dùng danh sách đánh giá đọc trước đó, đúng cách scraper hiện hoạt động. Nếu dựng lại từ nguồn mới, kết quả đúng là **[5, 5]**.
4. Guard gắn slug vào **A**: so nguồn slug 5 với điểm A 5 rồi coi là khớp. B còn điểm 4 không được kiểm tra với bản nguồn có hiệu lực của B. Nhận **`hasNewerSession14=false`, `isStale=false`**.
5. CP1/CP2 trong fixture đã được bộ dựng thật đọc đầy đủ; **`missingCheckpointScores=false`**, nên không có cảnh báo CP che lấp lỗi này.
6. Lưu snapshot [5, 4] vào SQLite tạm; GET thật tiếp tục báo không cũ. POST approve thật với phiên bản đúng trả **HTTP 200**, `contentHash` có giá trị, điểm đã duyệt vẫn **[5, 4]**, `staleness.isStale=false`.

**Ảnh hưởng:** lỗi còn cho phép điểm cũ đi vào bản đã duyệt mà không cảnh báo, cùng nhóm hậu quả quan trọng của S4-01. Luồng gộp duyệt/đồng bộ có thể tiếp tục sử dụng phiếu đó. Lần kiểm định này **không gửi điểm lên Teaching**; bằng chứng chỉ đến bước duyệt cục bộ và đối chiếu bộ dựng snapshot thật.

**Cách sửa nhỏ nhất:** đối chiếu theo **từng học sinh với bản đánh giá thực sự được scraper chọn**, giữ đúng thứ tự ưu tiên định danh. Không gán một slug trùng tên vào bạn đầu tiên rồi coi đã kiểm xong nguồn đó. Khi không xác định được duy nhất nguồn của một bạn, phải báo cần kiểm tra thay vì kết luận phiếu đã mới. Có thể dùng chung hàm chọn nguồn; không cần viết lại luồng tính điểm hoặc duyệt.

**Điều kiện đóng:** giữ đúng hai học sinh khác mã, có cả bản đánh giá UID riêng và slug chung; [5, 4] với nguồn hiện tại [5, 5] bắt buộc cảnh báo, snapshot mới [5, 5] phải hết cảnh báo. Kiểm lại qua GET/approve thật cùng với toàn bộ ca thời gian và điểm 0 đã đạt.

## 5. Phát hiện LOW bổ sung

### S4-R2-02 — LOW — Một bản chờ duyệt có Demo mặc định 0 khiến quét lại vẫn báo cũ

**Vị trí:** `src/app/api/report-card/route.ts:54–62`, `:163–169`.  
**Đối chiếu:** `src/lib/playwright/scrape-scores.ts:2391–2395`; `src/lib/db/sqlite.ts`, `session14EvalRepo.saveDraft`.  
**Bằng chứng:** `R2-02-RESCAN-1`, `R2-02-RESCAN-2`.

**Nguyên nhân:** guard coi mọi `WAITING_APPROVAL` là đánh giá có hiệu lực. Scraper chỉ dùng Demo > 0, APPROVED, VERIFIED hoặc `learnedFromMindx` có nội dung; nó **không có điều kiện WAITING_APPROVAL riêng**.

**Tái hiện:** gọi `saveDraft` thật, chỉ lưu `suggestionsFromMindx`. Bản ghi nhận `status=WAITING_APPROVAL`, Demo **0**, `learnedFromMindx=''`. Điểm Demo thật trong dữ liệu LMS giả là **4**. Sau hai lần dựng snapshot mới hoàn toàn từ cùng nguồn, scraper đều giữ **4**, trong khi guard đòi khớp **0** và vẫn báo có Buổi 14 mới. Mốc cập nhật nguồn nằm trước cả hai snapshot; CP đầy đủ.

**Ảnh hưởng:** hướng dẫn bấm Quét lại không giải quyết được cảnh báo. Chưa chứng minh có ghi sai điểm do cảnh báo nhầm này; xếp LOW, không nâng thành lỗi mất dữ liệu.

**Cách sửa:** dùng chung điều kiện xác định đánh giá có hiệu lực với scraper. Nếu sản phẩm muốn WAITING_APPROVAL cũng thay thế điểm LMS, cần thống nhất cả hai nơi và kiểm riêng Demo 0 đã chấm với 0 mặc định; không chỉ mở rộng điều kiện ở guard.

**Điều kiện đóng:** bản chờ duyệt chỉ có nội dung góp ý, Demo mặc định 0 và chưa có thư không làm snapshot mới bị báo cũ vô hạn; các bản 0 có hiệu lực vẫn được bảo vệ như S4-02.

### S4-R2-03 — LOW — Bản đánh giá theo mã CRM đã được quét vào phiếu vẫn bị coi là không tìm thấy học sinh

**Vị trí:** `src/app/api/report-card/route.ts:113–120`, `:138–160`.  
**Đối chiếu:** `src/lib/playwright/scrape-scores.ts:2226–2229`, `:2433–2441`.  
**Bằng chứng:** `R2-03-RESCAN-1`, `R2-03-RESCAN-2`.

**Nguyên nhân:** scraper chọn nguồn bằng cả `crmStudentId`, nhưng snapshot xuất ra chỉ lưu `studentId` và `studentUid`. Guard không có bước khôi phục quan hệ CRM đó. Bảng tên phụ cũng không tìm được khi mã CRM của đánh giá khác mã chuẩn đang lưu trong danh sách lớp.

**Tái hiện:** học sinh trong SQLite có mã `CANONICAL_A`, LMS có `CRM_A` và `UID_A`, tên duy nhất khớp nhau; đánh giá theo `CRM_A` có Demo **5**. Bộ dựng thật chọn đúng đánh giá này và xuất snapshot `studentId=CANONICAL_A`, `studentUid=UID_A`, Demo **5**. Guard không tìm được `CRM_A` trong bảng tra rồi báo cũ. Hai snapshot mới liên tiếp đều **5**, bằng nguồn hiện tại, nhưng cảnh báo vẫn còn; CP đầy đủ và thời gian nguồn cũ hơn snapshot.

**Ảnh hưởng:** cảnh báo nhầm kéo dài dù quét đã lấy đúng điểm. Chưa thấy ghi sai điểm trực tiếp trong ca này; xếp LOW.

**Cách sửa:** bảo toàn/khôi phục nguồn định danh mà scraper thực sự đã dùng, hoặc dùng chung bước giải định danh với đầy đủ dữ liệu cần thiết. Không coi mọi bản đánh giá khác mã snapshot là học sinh thiếu khi scraper vừa sử dụng chính bản đó.

**Điều kiện đóng:** nguồn CRM hợp lệ và snapshot mới cùng điểm phải hết cảnh báo; sửa điểm nguồn sau đó vẫn phải được nhận biết. Kiểm cả khi mã chuẩn, CRM và UID đều khác nhau.

## 6. Những phần giữ được kết quả đạt và khoảng trống kiểm thử

- Các ca gốc về khoảng chồng thời gian và Demo 0 đã được nhận biết. Năm kiểu ghép đơn nghĩa (`studentId`, `studentUid`, `lmsStudentUid`, tên chuẩn hóa qua danh sách lớp, slug) đều nhận biết thay đổi và hết cảnh báo khi điểm khớp trong probe riêng. Lỗi HIGH nằm ở **sự kết hợp nguồn và thứ tự ưu tiên**, không phải mọi ca dùng slug đều hỏng.
- DRAFT mới nguyên do `getOrInit` tạo không bị báo cũ chỉ vì giờ tạo muộn hơn snapshot; thay đổi điểm Năng lực có hiệu lực cũng được nhận biết.
- S4-T1 và probe closure xác nhận approve trước sync; approve lỗi 400/409/500, mất mạng, đổi lớp hoặc phản hồi cũ không gọi tiếp sync. Sync lỗi/409 hoặc kết quả của lớp cũ không báo thành công; các cờ đang xử lý được giải phóng trong các ca đã chạy.
- Route sync thật từ chối phiên bản sai bằng 409, hash sai bằng 400 và yêu cầu duyệt lại. Bảy handler được probe từ chối request không cục bộ bằng 403. Không có thay đổi S4 tạo thêm BrowserContext; quét vẫn qua hàng đợi tuần tự.
- Điểm CP 0 vẫn được coi là đã có; null cả checkpoint được báo thiếu; học sinh không còn học không làm ca đủ điểm bị báo thiếu. Cơ chế hiện tại chỉ báo thiếu khi **toàn bộ học sinh đang học** thiếu mọi thành phần của CP tương ứng; không coi đó là kiểm tra mọi ô trống.
- Bộ định dạng giữ điểm 0 và trạng thái bài nộp; CSV thật, TSV qua bộ hồi quy và 29 phép đối chiếu helper bổ sung đều đạt. Import dùng để nạp helper trong Zalo và các biến toàn cục phục vụ VM vẫn tồn tại; không có finding bảo mật mới được chứng minh từ chúng.
- Phiếu điểm luôn được render, bài nộp nằm trong mục thu gọn, đã bỏ nút quét trùng/tab cũ/khối chết được chỉ định. Đây là xác minh mã nguồn và harness, không phải đo thao tác chuột hoặc lưu lượng tải trong trình duyệt thật.

**Vì sao S4-T5 vẫn đạt:** test mới dùng một học sinh với một mã trùng trực tiếp giữa nguồn và snapshot; các phép chuyển điểm chủ yếu đặt bản nguồn APPROVED và tự dựng snapshot. Nó không gọi bộ dựng thật để đối chiếu **nhiều nguồn định danh cùng tồn tại**, không có hai học sinh trùng tên, không có bản chờ duyệt Demo mặc định 0 với thư trống, và không có nguồn CRM khác cả mã chuẩn lẫn UID. Vì vậy các kiểm tra hiện có chưa bắt được ba vấn đề trên. Không sửa kiểm thử sản phẩm trong lần audit này.

## 7. Giới hạn kết luận

Chưa chạy `next build`, bản phát hành đầy đủ, trình duyệt thật, clipboard thật hoặc đo số lần tải thực tế. Chưa quét LMS, ghi Teaching hay đọc lại dữ liệu từ tài khoản thật. Các dữ liệu học sinh trong probe là giả, tên mẫu không được lấy từ dữ liệu Owner. Không nghiệm thu các chặng khác hoặc toàn bộ v3.4.0 từ kết quả S4 này.

Hai cảnh báo nhầm LOW được phát hiện trong vòng kiểm định này; không mặc nhiên khẳng định mọi dòng mã gây ra chúng đều mới được thêm ở Round 2. Chúng thuộc cơ chế S4 đang được xét và đều có đầu vào cụ thể cùng kết quả tái hiện.

## 8. Hồ sơ tái kiểm và việc tiếp theo

- [closure-probe.cjs](s4-round2/closure-probe.cjs), [closure-results.json](s4-round2/closure-results.json): đóng các tình huống gốc và kiểm soát hồi quy.
- [parity-probe.cjs](s4-round2/parity-probe.cjs), [parity-results.json](s4-round2/parity-results.json): 14 quan sát, 6 OPEN thuộc 3 phát hiện bổ sung.
- [gates.json](s4-round2/gates.json), [environment.json](s4-round2/environment.json): mã thoát, thời gian của bốn kiểm tra chính và môi trường cô lập.
- [working-tree.patch](s4-round2/working-tree.patch): diff sáu tệp đã được Git theo dõi. Hai tệp S4 mới chưa được theo dõi được nhận diện bằng dấu vân tay, không giả định chúng có trong patch này.
- [protected-before.json](s4-round2/protected-before.json), [protected-verification.json](s4-round2/protected-verification.json), [tsbuildinfo-verification.json](s4-round2/tsbuildinfo-verification.json): bằng chứng bảo toàn tệp có sẵn và hồ sơ Round 1.

Để tái chạy hai probe, mở PowerShell tại `F:\MINDX_project test\MINDX-AUTOMATION` và chạy:

```powershell
$env:ALLOWED_LOCAL_DIRS=$env:TEMP
$env:MINDX_DB_PATH="$env:TEMP\codex_s4_r2.db"
$env:MINDX_RUNNING_CLASSES_PATH="$env:TEMP\codex_s4_r2_rc.json"
New-Item -ItemType Directory -Force -Path "$env:TEMP\codex_s4_r2_audit" | Out-Null
node --require tsx/cjs docs/audits/v340/s4-round2/closure-probe.cjs
node --require tsx/cjs docs/audits/v340/s4-round2/parity-probe.cjs
```

Ưu tiên sửa **S4-R2-01** để mỗi học sinh được đối chiếu với đúng nguồn, rồi thống nhất điều kiện hiệu lực và cầu nối CRM để xử lý hai cảnh báo nhầm. Bổ sung kiểm thử dùng bộ dựng snapshot thật, chạy lại bốn kiểm tra chính và hai probe với kỳ vọng đóng lỗi. Không cần Owner thao tác tài khoản hay dữ liệu thật để hoàn tất bước sửa này.

**VERDICT CUỐI: NO-GO — còn 1 HIGH (S4-R2-01, phần định danh chưa đóng của S4-01); 2 LOW cần theo dõi. Không sửa mã ứng dụng hoặc bằng chứng Round 1.**
