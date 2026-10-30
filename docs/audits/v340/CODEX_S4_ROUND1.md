# Kiểm định độc lập S4 — v3.4.0 — Round 1

**VERDICT: NO-GO**

**Ngày:** 2026-10-30, múi giờ `Asia/Saigon`.  
**Mốc mã:** `930132f04e7f4fe411f2c3c9df58305d7a7fa51b` **cộng các thay đổi chưa commit trong cây làm việc**; không phải kết luận cho riêng commit HEAD.  
**Vai trò:** Senior Auditor độc lập theo yêu cầu; chỉ kiểm định, không sửa mã ứng dụng.  
**Kết quả:** **0 CRITICAL / 1 HIGH / 1 MEDIUM / 1 LOW**. Theo quy tắc nghiệm thu đã giao, HIGH hoặc MEDIUM còn mở bắt buộc **NO-GO**.

S4 đưa Phiếu điểm lên màn hình chính, chuyển chi tiết bài nộp thành mục thu gọn, gộp duyệt và đồng bộ Teaching thành một lần bấm, dùng chung bộ định dạng xuất điểm và bổ sung cảnh báo bản quét cũ. Ba bộ kiểm thử được yêu cầu và TypeScript đều đạt. Tuy nhiên, kiểm tra bổ sung tái hiện hai trường hợp **điểm Buổi 14 đã đổi nhưng hệ thống không cảnh báo**. Một ca đã được xác nhận qua route thật và SQLite tạm: bản điểm cũ vẫn nhận HTTP 200 khi duyệt và được gắn khóa nội dung.

## 1. Phạm vi và cách bảo vệ dữ liệu

Đã đọc `PROJECT_STATE.md` đầu tiên, đối chiếu `MINDX_AUTOMATION_PLAN.md`, `CHANGELOG.md`, trạng thái Git, toàn bộ diff liên quan và các đường gọi thực tế.

| Tệp thay đổi/mới | Nội dung đã kiểm tra |
|---|---|
| `src/lib/report-card/export-cell-formatter.ts` | Trạng thái bài nộp, chế độ practice/quiz/both, điểm 0, chống công thức bảng tính, tác dụng phụ khi import. |
| `src/app/api/homework-grader/export/route.ts` | Gọi helper chung, dữ liệu CSV/XLSX, kiểm tra yêu cầu từ máy cục bộ. |
| `src/app/api/homework-grader/scores/route.ts` | Helper xếp hàng dùng chung, POST, GET sau khi bỏ sessions/students/rubrics và các nơi dùng GET. |
| `src/app/api/report-card/route.ts` | GET/POST/PUT, approve dùng chung, khóa phiên bản, staleness, thời gian và dữ liệu CP. |
| `src/components/teaching-report-card-view.tsx` | Chuỗi approve → sync, lỗi/409, chuyển lớp, phản hồi cũ, cờ đang xử lý, cảnh báo và các nút. |
| `src/app/homework-grader/page.tsx` | Luồng quét qua component con, tải dữ liệu khi mở trang, mục thu gọn, xuất file và TSV, các khối bị bỏ. |
| `scripts/test-streamline-v340-s4.ts` | Cách cách ly dữ liệu, harness mô phỏng component, toàn bộ S4-T1..S4-T4 và các khoảng trống kiểm thử. |
| `src/lib/zalo/broadcast-generator.ts` | **Thay đổi ngoài danh sách S4 nhưng đang có trong cây làm việc:** thêm import helper xuất điểm và `void _preloadExportFormatter`. Đã đọc, không sửa. |

Đã lần theo `sqlite.ts`, `scrape-scores.ts`, `teaching-report-card-sync.ts`, route `sync-teaching`, `local-guard.ts`, `task-queue.ts`, các nơi gọi API và hai bộ kiểm thử hồi quy. Giả định tải sử dụng: một ứng dụng cục bộ của giáo viên, có thể mở nhiều trang/tab và sửa Buổi 14 trong lúc quét điểm. Không giả định hệ thống chạy nhiều máy chủ.

Tất cả lệnh thực thi kiểm thử đều được cấp các biến sau trước khi khởi chạy tiến trình:

```powershell
$env:ALLOWED_LOCAL_DIRS=$env:TEMP
$env:MINDX_DB_PATH="$env:TEMP\codex_s4.db"
$env:MINDX_RUNNING_CLASSES_PATH="$env:TEMP\codex_s4_rc.json"
```

- Bộ S4 tự chuyển tiếp sang thư mục con ngẫu nhiên trong TEMP; bộ v330 cũng tự tạo DB/cache con trong TEMP. Đã đọc phần khởi tạo để xác nhận. Phase4 và probe độc lập dùng các đường dẫn tạm được cấp từ bên ngoài.
- Probe độc lập kiểm tra đường dẫn DB/cache nằm trong TEMP trước khi import mã nghiệp vụ.
- **Không mở, đọc, băm, sao chép hoặc sửa** `data/mindx_bot.db` và `data/running_classes.json`. Vì vậy báo cáo không đưa ra một giá trị SHA-256 mới của dữ liệu vận hành.
- Không chạy máy chủ ứng dụng, không đăng nhập, không gọi LMS/Teaching thật, không gọi Gemini, không commit hoặc push.
- Các ca sync thật trong probe chỉ đi đến nhánh từ chối phiên bản/hash, dừng trước phần truy cập Teaching. Các ca UI dùng fetch giả lập.
- `tsconfig.tsbuildinfo` được sao lưu vào TEMP trước khi chạy. TypeScript dùng `--incremental false`; đối chiếu cuối xác nhận **không đổi byte**, không cần ghi đè để phục hồi.
- Đối chiếu SHA-256 của **8/8 tệp mã/test đã thay đổi hoặc mới có sẵn lúc bắt đầu** xác nhận chúng không đổi trong quá trình kiểm định. Chỉ thêm báo cáo và bằng chứng bên dưới `docs/audits/v340/`.

Không sửa ba tài liệu theo dõi tiến độ trong lần này: yêu cầu hiện tại là báo cáo kiểm định độc lập, không phải triển khai hoặc đóng S4. Các mốc GO lịch sử trong tài liệu dự án không thay thế kết quả chạy mới của lần này.

## 2. Kiểm thử đã chạy mới

Môi trường: Windows/PowerShell, Node `v24.21.0`, TypeScript `7.0.2`, các thư viện đã cài trong dự án. Dùng lệnh trực tiếp trong `node_modules/.bin` để không cài thêm thư viện.

| Lệnh tại thư mục gốc dự án | Exit | Kết quả | Bằng chứng |
|---|---:|---|---|
| `.\node_modules\.bin\tsx.cmd scripts/test-streamline-v340-s4.ts` | 0 | PASS, S4-T1..S4-T4 | [s4-test.log](s4-round1/s4-test.log) |
| `.\node_modules\.bin\tsx.cmd scripts/test-report-card-v330.ts` | 0 | PASS, RC-01..RC-06 | [v330-test.log](s4-round1/v330-test.log) |
| `.\node_modules\.bin\tsx.cmd scripts/test-phase4-codex-repros.ts` | 0 | PASS, toàn bộ nhóm hồi quy mà script chạy, Round 1..17 | [phase4-test.log](s4-round1/phase4-test.log) |
| `.\node_modules\.bin\tsc.cmd --noEmit --incremental false` | 0 | PASS, không có lỗi TypeScript | [tsc.log](s4-round1/tsc.log) |
| `node --require tsx/cjs docs/audits/v340/s4-round1/probe.cjs` | 0 | 25 bản ghi quan sát; tái hiện 3 finding và các ca kiểm soát | [probe.log](s4-round1/probe.log), [probe-results.json](s4-round1/probe-results.json) |

**Lưu ý cách đọc:** probe thoát 0 vì các assertion xác nhận đúng hành vi quan sát được, kể cả hành vi sai cần sửa; điều đó **không** có nghĩa 25 ca nghiệm thu đều đạt. Trong 25 bản ghi có **4 bản ghi tái hiện lỗi** (`P02`, `P03`, `P04`, `P06`) thuộc **3 finding**, và **21 bản ghi kiểm soát đạt**. Các bản ghi có thể chứa nhiều assertion; không cộng chúng thành một số lượng ca kiểm thử duy nhất. Riêng bản ghi định dạng có 29 phép đối chiếu.

Trong quá trình dựng probe, lần chạy đầu dừng vì harness kiểm định chưa cấp biến `process` cho môi trường mô phỏng. Đã sửa **chỉ probe**, chạy lại thành công rồi bổ sung các ca biên và chạy toàn bộ probe lần cuối. Kết quả lưu kèm là lần cuối; đây không phải lỗi ứng dụng.

Thông báo PowerShell `NativeCommandError` bao quanh dòng dotenv ghi ra stderr trong một số log không phải kết luận thất bại của bộ kiểm thử. Mã thoát thật của từng lệnh đã được thu riêng, đều là 0 trong bảng trên.

## 3. Các phát hiện bắt buộc sửa

### S4-01 — HIGH — Bỏ sót điểm Buổi 14 sửa trong lúc quét

**Vị trí chính:** `src/app/api/report-card/route.ts:71–76`.  
**Luồng liên quan:** `src/lib/playwright/scrape-scores.ts:693–698`, `:1325–1336`, `:1367`.

**Nguyên nhân:** `computeReportCardStaleness` chỉ so nội dung điểm nếu lần sửa gần nhất nằm cùng giây với `snapshot.scrapedAt`. Nếu thời gian sửa cũ hơn giây hoàn tất quét, hàm bỏ qua việc so điểm và trả `hasNewerSession14=false`.

Nhưng quy trình quét thật đọc `session14Evals` vào bộ nhớ **trước khi** hoàn tất thu thập các trang bài nộp. Sau đó mới tạo `scrapedAt` lúc cuối và dựng snapshot từ danh sách Buổi 14 đã đọc trước đó. Giờ hoàn tất không bảo đảm điểm Buổi 14 trong snapshot được đọc vào chính giờ đó. Hàng đợi tuần tự cho trình duyệt cũng không khóa việc giáo viên lưu bản đánh giá Buổi 14 qua API cục bộ.

**Tái hiện có bằng chứng (`P02`, `P03`):**

1. Lúc `08:00:00Z`, một lần quét đã đọc điểm Demo **4** vào bộ nhớ.
2. Giáo viên sửa Demo thành **5** lúc `08:00:30Z` trong lúc lần quét vẫn xử lý các trang khác.
3. Quét hoàn tất lúc `08:01:00Z`, lưu snapshot chứa Demo **4** với `scrapedAt=08:01:00Z`.
4. Dùng đúng hàm thật và dữ liệu Buổi 14 trong SQLite tạm: nhận **`isStale=false`**, dù snapshot là 4 và điểm hiện tại là 5.
5. Lưu snapshot giả lập hợp lệ, gọi route POST approve thật với phiên bản đúng: nhận **HTTP 200**, `contentHash` có giá trị, `staleness.isStale=false`, điểm trong payload vẫn **4**.

**Giới hạn bằng chứng:** đã tái hiện trạng thái dữ liệu xảy ra khi quét chồng với sửa điểm và chạy hàm/route/SQLite thật; chưa vận hành cả lượt quét Playwright với LMS thật, chưa đẩy điểm 4 lên Teaching. Khoảng thời gian có thể tạo trạng thái này được xác nhận từ luồng đọc/ghi mã nguồn nêu trên.

**Ảnh hưởng:** giáo viên có thể duyệt và tiếp tục đồng bộ điểm cũ mà không được cảnh báo. Khóa SHA-256 chỉ bảo vệ nội dung snapshot đã lưu; nó không chứng minh snapshot đã chứa lần sửa Buổi 14 mới nhất. Đây là thiếu sót của cơ chế cảnh báo S4 mới, không quy thao tác đọc sớm vốn có của scraper thành thay đổi mới của S4.

**Cách sửa nhỏ nhất:** đừng dùng giờ hoàn tất để loại bỏ việc đối chiếu điểm nguồn. Đối chiếu các trường điểm Buổi 14 **có hiệu lực** với snapshot ngay cả khi `updatedAt` nằm trước giây hoàn tất quét; dùng cùng quy tắc nhận diện học viên và xác định bản đánh giá có hiệu lực như scraper. Cần tránh coi các điểm mặc định của bản DRAFT chưa đánh giá là điểm mới. Nếu chọn lưu mốc phiên bản/băm của nguồn vào snapshot thì phải kiểm chứng toàn bộ nơi tạo snapshot, nhưng không cần thay đổi cấu trúc lớn chỉ để vá hai điều kiện thời gian.

**Điều kiện đóng:** ca quét đọc điểm 4 → nguồn được sửa thành 5 → quét hoàn tất sau lần sửa phải trả cảnh báo. Sau một lần quét thực sự chứa điểm 5, cảnh báo phải hết. Phải giữ khả năng lưu điểm sửa tay và khóa phiên bản hiện tại.

### S4-02 — MEDIUM — Sửa điểm Demo về 0 trong cùng giây không được phát hiện

**Vị trí:** `src/app/api/report-card/route.ts:80–94`.  
**Đối chiếu nghiệp vụ:** `src/lib/playwright/scrape-scores.ts:2391–2403` cho phép điểm Demo **0** của bản đánh giá có hiệu lực.

**Nguyên nhân:** nhánh bù cho độ chính xác một giây chỉ so `finalProduct` khi **`demoScore > 0`**. Điểm 0 hợp lệ bị loại khỏi phép so sánh. Điểm Năng lực vẫn có thể bằng 4 ở cả nguồn và snapshot nên không phát hiện thay đổi thay cho Demo.

**Tái hiện (`P04`, ca kiểm soát `P05`):**

1. Snapshot có Demo **4**, Năng lực **4**, `scrapedAt=2026-10-30T08:00:00.500Z`.
2. Bản đánh giá có hiệu lực hiện tại có Demo **0**, Năng lực **4**, `updatedAt=2026-10-30T08:00:00.000Z`. Đây là thời gian độ chính xác một giây như cách SQLite lưu, biểu diễn ISO trong fixture để cố định ca kiểm tra.
3. Nhánh so cùng giây được thực thi nhưng bỏ qua Demo 0: nhận **`isStale=false`**, kỳ vọng **true**.
4. Chỉ đổi điểm nguồn từ 0 sang **5**, giữ nguyên thời gian và Năng lực: hàm phát hiện đúng thay đổi. Như vậy lỗi nằm ở điều kiện điểm dương, không phải phân tích giờ.

**Ảnh hưởng:** giáo viên sửa một điểm đã có về 0 nhưng phiếu vẫn giữ điểm cũ và không báo. Sửa S4-01 mà vẫn giữ điều kiện `> 0` sẽ chưa đóng lỗi này.

**Cách sửa:** xác định bản đánh giá đã có hiệu lực theo quy tắc của scraper, kiểm tra điểm số hợp lệ và so cả **0**. Không chỉ đổi `> 0` thành `>= 0` cho mọi bản DRAFT vì điều đó có thể tạo cảnh báo từ điểm mặc định chưa chấm.

**Điều kiện đóng:** cùng giây phải nhận biết `4 → 0`, `0 → 4`, `4 → 5`; không báo khi điểm có hiệu lực không đổi hoặc chỉ có bản DRAFT mặc định. Có kiểm thử giờ ISO và định dạng giờ cục bộ do SQLite tạo.

## 4. Phát hiện mức thấp

### S4-03 — LOW — Tiêu đề cảnh báo luôn nói có dữ liệu Buổi 14 mới, kể cả chỉ thiếu CP

**Vị trí:** `src/components/teaching-report-card-view.tsx:2144–2152`.

**Nguyên nhân:** banner xuất hiện với mọi `isStale`, nhưng tiêu đề được viết cố định là `Có dữ liệu Buổi 14 mới, bấm Quét lại`. Trong khi API cũng đặt `isStale=true` khi chỉ thiếu điểm Check-point.

**Tái hiện (`P06`):** `hasNewerSession14=false`, `missingCp2=true`, lý do là thiếu CP2; component vẫn hiện tiêu đề có dữ liệu Buổi 14 mới.

**Ảnh hưởng:** giáo viên nhận sai nguyên nhân và có thể quét lại nhiều lần một lớp chưa đến buổi CP2. Đây là lỗi nội dung hướng dẫn, chưa thấy gây ghi sai dữ liệu trực tiếp.

**Cách sửa:** chọn tiêu đề theo `hasNewerSession14`, hoặc dùng tiêu đề chung về việc cần kiểm tra phiếu điểm và hiển thị đúng `reasons` bên dưới. Không thay đổi điều kiện tính điểm.

**Điều kiện đóng:** kiểm tra riêng banner cho chỉ Buổi 14 mới, chỉ thiếu CP, và đồng thời cả hai.

## 5. Các phần đã xác nhận hoạt động

- Chuỗi một lần bấm approve → sync có mặt và đi đúng thứ tự trong S4-T1. POST và PUT approve cùng kiểm tra phiên bản qua helper chung.
- Lỗi approve **400/409/500**, lỗi mạng và phản hồi approve cũ hơn một GET đã nhận đều **không gọi sync** trong probe bổ sung.
- Chuyển lớp trong lúc chờ approve chặn bước sync; chuyển lớp trong lúc chờ sync không đưa kết quả lớp cũ vào trạng thái hoàn tất của lớp đang xem. Lỗi/409 ở bước sync không hiện thông báo thành công. Các cờ đang xử lý đã được giải phóng trong các ca này.
- Gọi handler sync thật với phiên bản sai nhận **409**; sửa giả `contentHash` trong SQLite tạm rồi sync nhận **400**, khóa bị xóa để yêu cầu duyệt lại. Không có truy cập Teaching trong hai ca từ chối này. RC-03/RC-05 cũng đạt kiểm thử khóa phiên bản, băm nội dung và đồng bộ có đối chiếu.
- Bảy handler trong các route liên quan đều trả **403** cho yêu cầu không phải từ máy cục bộ. Các đường quét dùng chung vẫn đi qua `taskQueue.enqueue`; không có phần tạo BrowserContext mới trong thay đổi S4.
- Giờ ISO và giờ SQLite cục bộ được hiểu nhất quán trong ca kiểm soát `P01` trên `Asia/Saigon`. Không kết luận có lỗi lệch múi giờ ở đường kiểm tra đã chạy.
- Điểm CP **0** được coi là đã có; toàn bộ CP1 hoặc CP2 là null được cảnh báo; học viên `isActive=false` không làm lớp đủ điểm bị báo thiếu; không có snapshot và không có đánh giá Buổi 14 không làm hàm lỗi. Logic hiện tại chỉ báo thiếu CP khi **tất cả** học viên đang học thiếu cả ba thành phần của checkpoint; kiểm định này không diễn giải nó thành cảnh báo cho mọi ô điểm còn trống.
- Bộ định dạng chung giữ đúng điểm 0, trạng thái chưa chấm/làm lại/chưa nộp và ba chế độ xuất. S4-T3 kiểm tra CSV thật; Phase4 kiểm tra xuất/TSV và chống công thức; probe thêm 29 phép đối chiếu helper. Hàm `sanitizeTsvCell` vẫn có nhiệm vụ bỏ tab/xuống dòng trước khi ghép TSV.
- Đã bỏ nút quét trùng ở Hero, bộ chuyển hai tab và các khối chết được chỉ định; Phiếu điểm luôn có mặt, chi tiết bài nộp được thu gọn. `scrapeTrigger=""` loại bỏ việc tải lại report-card chỉ vì cache của ma trận vừa trả về. Đây là xác nhận mã nguồn và harness, không phải đo số request trong trình duyệt thật hoặc nghiệm thu bố cục trên màn hình.

Một điểm cần ghi nhận về cách giữ tương thích: helper mới gán `__mindxExportHelpers` lên `URL`, `globalThis` và `console`; route/page có nhánh lấy lại helper từ các biến toàn cục đó, và Zalo thêm import chỉ để nạp helper. Bộ Phase4 cũ xóa import khi chạy một phần mã trong VM, nên hiện trạng này giúp nó tiếp tục chạy. Đây là sự phụ thuộc ngoài phạm vi nghiệp vụ S4 cần được người sửa biết đến; **không có thêm finding an toàn chưa được chứng minh** từ tác dụng phụ này. Không nên coi việc test đạt nhờ thứ tự nạp module là chứng cứ độc lập cho toàn bộ luồng xuất trên trình duyệt.

## 6. Khoảng trống kiểm thử và giới hạn kết luận

`S4-T2` hiện dùng thời gian ISO được đặt sẵn và chủ yếu kiểm tra sửa Buổi 14 **sau** giờ snapshot, thiếu toàn bộ CP2 và quét lại sau thời điểm đó. Nó không có khoảng chồng giữa lúc đọc nguồn và lúc hoàn tất quét, cũng không có ca sửa Demo về 0 trong cùng giây. Vì vậy ba bộ hồi quy vẫn xanh trong khi S4-01/S4-02 còn mở.

Chưa kiểm tra trong lần này:

- Chạy `next build`, khởi động bản phát hành, hay kiểm chứng khả năng đóng gói toàn bộ ứng dụng.
- Bố cục, số lần tải thực tế, clipboard, thu gọn/mở rộng và thao tác chuột trên trình duyệt thật.
- Quét LMS thật, xác nhận HTTP nghiệp vụ thật, ghi Teaching thật và đọc lại sau ghi trên tài khoản Owner.
- Chấp nhận toàn bộ v3.4.0 hoặc các chặng ngoài S4. Những kết luận GO lịch sử không được kiểm định lại toàn bộ ở đây.

## 7. Hành động tiếp theo và điều kiện nghiệm thu

1. Sửa **S4-01** và **S4-02** ở cơ chế nhận biết điểm nguồn đã thay đổi; giữ cơ chế khóa phiên bản và SHA-256 hiện có.
2. Sửa nội dung banner **S4-03** để giáo viên thấy đúng lý do.
3. Thêm kiểm thử kỳ vọng đúng cho các ca biên nói trên, chạy lại ba bộ được yêu cầu và TypeScript với DB/cache trong TEMP.
4. Reviewer kiểm tra lại bản mã sau sửa, xác nhận cảnh báo xuất hiện khi nguồn khác và hết khi quét đã thực sự cập nhật; sau đó mới xét GO S4. Auditor hiện tại chưa thực hiện các sửa đổi này.

**VERDICT CUỐI: NO-GO — S4-01 (HIGH) và S4-02 (MEDIUM) còn mở.**

## 8. Hồ sơ tái kiểm

- [Probe độc lập](s4-round1/probe.cjs): dùng lại phần harness component của S4 để chạy mã component thật, bổ sung các tình huống độc lập và gọi route/SQLite thật khi kiểm tra khóa. Không gọi dịch vụ bên ngoài.
- [Kết quả có cấu trúc](s4-round1/probe-results.json), [log probe](s4-round1/probe.log).
- [Dấu vân tay tệp lúc bắt đầu](s4-round1/source-before.json), [đối chiếu cuối](s4-round1/source-verification.json).
- [Đối chiếu tsconfig.tsbuildinfo](s4-round1/tsbuildinfo-verification.json).
- Các log kiểm thử trong bảng mục 2. `tsc.log` rỗng vì TypeScript không xuất lỗi.

Để tái chạy probe, mở PowerShell tại `F:\MINDX_project test\MINDX-AUTOMATION` và chạy nguyên khối sau. Chỉ dùng dữ liệu giả và tệp trong TEMP:

```powershell
$env:ALLOWED_LOCAL_DIRS=$env:TEMP
$env:MINDX_DB_PATH="$env:TEMP\codex_s4.db"
$env:MINDX_RUNNING_CLASSES_PATH="$env:TEMP\codex_s4_rc.json"
New-Item -ItemType Directory -Force -Path "$env:TEMP\codex_s4_audit_round1" | Out-Null
node --require tsx/cjs docs/audits/v340/s4-round1/probe.cjs
```

Probe Round 1 khóa các hành vi lỗi đã quan sát; sau khi sửa, những assertion ghi nhận lỗi cũ cần được chuyển thành kỳ vọng đóng lỗi trong bộ kiểm thử hồi quy. Không sửa probe lịch sử để làm mất bằng chứng Round 1.
