Verdict: NO-GO

# Kiểm định độc lập v3.4.0 — Chặng S6, Vòng 1

- Ngày: **2026-10-30**. Reviewer: **Codex độc lập**.
- Mốc kiểm: HEAD **`2ce97352959be286aecb87d8371c70ea6a4fb484` cộng cây mã S6 chưa commit**, được chốt bằng [source-before.json](s6-round1/source-before.json), [working-tree.patch](s6-round1/working-tree.patch), [reviewed-untracked](s6-round1/reviewed-untracked/) và [git-status-before.txt](s6-round1/git-status-before.txt). Kết luận không áp dụng riêng cho HEAD.
- Đối chiếu kế hoạch Owner duyệt: [approved-plan.source.md](s6-round1/approved-plan.source.md), mục **S6.1–S6.6** và Q4; đã đọc `AGENTS.md`, `PROJECT_STATE.md`, `CHANGELOG.md`, `MINDX_AUTOMATION_PLAN.md`.
- Phạm vi: ứng dụng cục bộ cho một giáo viên, có thể đổi lớp/buổi trong khi yêu cầu đang chờ; dữ liệu kiểm thử hoàn toàn giả lập.

## Kết quả chính

**Có 7 phát hiện cần sửa: 1 HIGH, 6 MEDIUM.** Quan trọng nhất: kết quả nộp Buổi 14 của lớp A còn được dùng sau khi chuyển sang lớp B, làm xuất hiện nút cập nhật cả lớp B lên 100% dù lớp B chưa nộp.

**18/18 cổng bắt buộc đạt kết quả cuối**, gồm bộ S6 mới, cổng nền và S1–S5a/S5b. TypeScript tại workspace gốc cũng **PASS**. Hai lỗi lượt đầu thuộc cách dựng bản sao kiểm thử đã được khắc phục và chạy lại nguyên bài kiểm tra, không sửa bài kiểm tra sản phẩm.

Probe độc lập có **29 quan sát**: **17 đúng kỳ vọng, 12 bất đạt**; thêm **1 quan sát production chẩn đoán bất đạt**. Các quan sát bất đạt được nhóm thành 7 phát hiện bên dưới, không phải 13 lỗi riêng. Mã thoát 0 của probe ghi đo chỉ cho biết đã chạy hết; phải đọc trường `expected`, `actual`, `pass` trong JSON.

**Không sửa `src/**`, `scripts/**`, `next-env.d.ts`; 142/142 tệp nguồn/test và `next-env.d.ts` giữ nguyên. Không mở, băm, sao chép hay kết nối tới hai tệp dữ liệu thật của Owner. Không commit, không gọi LMS/Teaching thật.** Xác minh: [source-integrity.json](s6-round1/source-integrity.json).

## Đối chiếu S6.1–S6.6

| Hạng mục | Kết quả | Bằng chứng / giới hạn |
| --- | --- | --- |
| S6.1 — Màn 5 một nút, ánh xạ buổi, Nâng cao | Đạt phần ánh xạ và giao diện; còn `S6-06` | Buổi ≤10/11/12/13/≥14 → 0/20/60/80/100%; nút mốc, ngày LMS và thanh kéo ẩn khi thu gọn. Khi không có dữ liệu buổi, API lại tự cho là Buổi 11. |
| S6.2 — Gợi ý tiến độ sau VERIFIED | **Không đạt** | Có gọi đúng `/api/teaching-projects/progress`; lỗi phạm vi lớp và bỏ sót bài lỗi ngoài đợt nộp: `S6-01`, `S6-02`. |
| S6.3 — Buổi 14 → Phiếu điểm → Quét | **Không đạt điều kiện hiển thị**; luồng mở/quét đạt | Link đúng `classId`/`autoScan=1`; trang Phiếu điểm quét đúng lớp và tải lại Phiếu điểm sau quét. Nhưng gợi ý có thể xuất hiện khi còn bản nháp/đánh giá chưa VERIFIED: `S6-03`. |
| S6.4 — Việc cần làm hôm nay | **Không đạt** | Sinh đúng chuỗi việc và đường dẫn; sai khi thiếu bản ghi học viên, khi làm tròn tiến độ và khi chạy bản đóng gói: `S6-04`, `S6-05`, `S6-07`. |
| S6.5 — Bỏ approve/approve_and_save và khối chết | **Đạt** | Hai hành động trả HTTP 400; `save_draft` còn hoạt động; v320 đủ TP-01–TP-06 PASS; không còn `{false && ...}` ở hai trang được yêu cầu. |
| S6.6 — Bộ kiểm thử S6 và probe độc lập | Bài kiểm tra có sẵn PASS; **chưa đủ làm căn cứ GO** | Bài có sẵn chưa phủ đổi lớp sau combo, thiếu bản ghi học viên, đánh giá VERIFIED một phần và Trang chủ bị tạo cố định lúc đóng gói. Probe bổ sung đã tái hiện các ca này. |

## Các phát hiện cần sửa

### S6-01 — HIGH — Kết quả nộp lớp A mở nút đẩy 100% cho lớp B

**Vị trí:** `src/components/final-project/SubmitBar.tsx:73–116, 123–140`; `src/components/final-project/useSpckWorkflow.ts:893–905`; `src/app/final-project/page.tsx:1248–1263`.

**Nguyên nhân:** `session14ComboStatus` không mang khóa lớp/buổi và không được xóa khi đổi lớp. `SubmitBar` ưu tiên kết quả combo cũ hơn trạng thái các dòng đang hiển thị. Bộ đếm yêu cầu chỉ ngăn phản hồi cũ hiện banner, không ngăn kết quả lớp cũ mở nút gửi mới cho lớp đang chọn.

**Tái hiện đã chạy:** nộp đủ hai phần Buổi 14 lớp A `VT-C4K-JSB15` → giữ yêu cầu cập nhật Teaching của A chưa trả về → chọn B `VT-C4K-JSB16`, có hai bài `WAITING_APPROVAL`. Hai dòng B hiện “Chưa nộp” nhưng vẫn có gợi ý 100% và link Phiếu điểm mang mã B. Bấm gợi ý thực sự tạo POST `{classCode: 'VT-C4K-JSB16', milestoneTaskCount: 5, resetOthers: true}`. Đây là yêu cầu giả lập đã bắt được trong trình duyệt; không ghi lên dịch vụ thật.

**Ảnh hưởng:** giáo viên có thể đẩy tiến độ 100% cho lớp chưa hoàn tất, nếu dự án Teaching của lớp đó đã đủ điều kiện nhận cập nhật. Bộ bảo vệ task/student của Teaching không thay thế điều kiện hoàn tất SPCK.

**Cách sửa nhỏ nhất:** gắn khóa `classId + sessionNumber` vào kết quả combo/đợt nộp; xóa hoặc bỏ qua kết quả khác phạm vi ngay khi đổi lớp/buổi; tính điều kiện gợi ý trên dòng hiện tại và kiểm lại khóa khi bấm gửi. Giữ bộ chặn phản hồi muộn hiện có.

**Kiểm lại:** A hoàn tất → đổi B chưa nộp → không có hai gợi ý, không POST cho B; phản hồi A đến muộn không xuất hiện ở B. B phải tự hoàn tất mới được mở nút.

**Bằng chứng:** `UI06`, `UI07`, `UI09` FAIL; `UI08` PASS trong [ui-observations.json](s6-round1/ui-observations.json); [ảnh lớp B](s6-round1/class-B-stale-handoff.png).

### S6-02 — MEDIUM — Đợt nộp thành công che bài lỗi còn lại trong lớp

**Vị trí:** `src/components/final-project/SubmitBar.tsx:73–94`.

**Nguyên nhân:** khi có `lastSubmissionSummary`, số bài lỗi/chờ chỉ lấy từ `retryStudentIds` của đợt mới nhất. Các dòng khác của cùng lớp/buổi không còn được kiểm tra, ngoại trừ `isDirty`.

**Tái hiện đã chạy:** Buổi 12 có S1 VERIFIED và S2 FAILED; đợt nộp mới nhất chỉ gồm S1, đã VERIFIED, không có retry. Giao diện vẫn hiện nút “Cập nhật tiến độ Teaching lên 60%” cho cả lớp mặc dù S2 còn lỗi.

**Cách sửa:** dùng kết quả đợt nộp để trình bày báo cáo; điều kiện mở gợi ý phải đối chiếu toàn bộ tập bài thuộc phạm vi cần hoàn tất của lớp/buổi hiện tại, kể cả bài ngoài đợt mới nhất. Còn FAILED/chờ nộp/bản nháp thì chặn.

**Kiểm lại:** đợt mới thành công một học viên không được xóa nghĩa của bài lỗi chưa xử lý; sau khi cả tập hợp hợp lệ VERIFIED mới mở gợi ý.

**Bằng chứng:** `UI13` FAIL trong [ui-observations.json](s6-round1/ui-observations.json); probe mount **component SubmitBar thật**, chỉ thay dữ liệu đầu vào của cha.

### S6-03 — MEDIUM — Mở Phiếu điểm khi Đánh giá hoặc bản nháp vẫn chưa hoàn tất

**Vị trí:** `src/components/final-project/SubmitBar.tsx:97–116`.

**Nguyên nhân:** chỉ yêu cầu số SPCK VERIFIED >0, số đánh giá VERIFIED >0 và danh sách retry rỗng. Không yêu cầu toàn bộ học viên cần nộp hoàn tất; không kiểm tra bản nháp SPCK còn sửa; nhánh combo `idle` vẫn có thể qua điều kiện.

**Tái hiện đã chạy:** (a) hai SPCK VERIFIED, một đánh giá VERIFIED và một DRAFT, chưa chạy combo → vẫn hiện link Phiếu điểm; (b) combo từng thành công, sau đó sửa SPCK của S1 (`isDirty=true`), S2 còn sạch → link vẫn hiện. Cùng tình huống (b), nút tiến độ đã ẩn đúng, cho thấy điều kiện giữa hai gợi ý không thống nhất.

**Cách sửa:** ràng buộc vào lần hoàn tất combo đúng phạm vi; cả hai phần phải VERIFIED cho đầy đủ tập học viên cần xử lý; không còn retry/lỗi/bản sửa chưa nộp. Dữ liệu đánh giá đã bị sửa sau combo cũng phải làm mất điều kiện hoàn tất.

**Kiểm lại:** chỉ khi cả hai phần hoàn tất hiện tại mới hiện link; DRAFT/FAILED/isDirty ở bất kỳ phần nào phải ẩn link; ca thành công vẫn giữ `classId` và `autoScan=1` đúng.

**Bằng chứng:** `UI10`, `UI11` FAIL; `UI12`, `UI05`, `UI14`, `UI15` PASS; [ảnh đánh giá một phần](s6-round1/partial-eval-handoff.png), [yêu cầu Phiếu điểm](s6-round1/homework-requests.json).

### S6-04 — MEDIUM — Trang chủ kiểm “mọi bản ghi”, chưa kiểm đủ đúng học viên

**Vị trí:** `src/lib/dashboard/today-tasks.ts:330–387, 425–434`.

**Nguyên nhân:** Nhận xét/Đánh giá so sánh COUNT VERIFIED với COUNT của các dòng đã có; SPCK dùng `every()` trên dòng có sẵn. Không đối chiếu tập học viên thực sự cần hoàn tất. `studentCount` không tham gia quyết định. Nhận xét còn đếm cả dòng học viên vắng — trong khi bộ lưu LMS chỉ xử lý học viên active có mặt/đi muộn (`save-comments.ts:513–525`).

**Tái hiện đã chạy trên SQLite giả:** lớp có hai học viên active; chỉ S1 có dòng VERIFIED, S2 chưa có dòng tương ứng. Trang chủ báo xong riêng từng mục Nhận xét, SPCK, Đánh giá. Khi bổ sung S2 DRAFT, từng mục lại chưa xong. Ngược lại, tất cả học viên có mặt đã VERIFIED nhưng S2 vắng với DRAFT thì mục Nhận xét vẫn chưa xong.

**Cách sửa:** xác định tập học viên cần xử lý theo cùng quy tắc của từng màn, rồi đối chiếu theo `studentId`, lớp và buổi. Thiếu dòng của học viên thuộc phạm vi phải là chưa xong; dòng học viên vắng/nghỉ không thuộc phạm vi không được chặn nhầm.

**Kiểm lại:** missing-row, explicit-DRAFT, full-VERIFIED, ABSENT và inactive; kiểm riêng Nhận xét, SPCK từng buổi và Đánh giá 14. Không chỉ kiểm 1 VERIFIED + 1 DRAFT đã có đủ dòng.

**Bằng chứng:** `DB01`, `DB04`, `DB07`, `DB11` FAIL; các đối chứng `DB02`, `DB03`, `DB05`, `DB06`, `DB08` PASS trong [repository-observations.json](s6-round1/repository-observations.json).

### S6-05 — MEDIUM — Làm tròn số làm tiến độ chưa đủ thành 100%

**Vị trí:** `src/lib/dashboard/today-tasks.ts:74, 255–288`; điều kiện bước 4 Buổi 14 tại `today-tasks.ts:107–111`.

**Tái hiện đã chạy:** hai học viên, năm việc trọng số 20%; mọi ô 100%, riêng việc 5 của S2 là 99%. Trung bình lớp thực là **99,9%**, nhưng bị làm tròn thành 100 và bước “Tiến độ 100%” được đánh dấu xong.

**Cách sửa:** tách số hiển thị đã làm tròn khỏi điều kiện hoàn tất; bước 100% chỉ xong khi đủ các ô cần thiết đạt chính xác yêu cầu. Không làm tròn trước khi so ngưỡng các mốc khác.

**Kiểm lại:** 99/100, 99,9% và thiếu khóa tiến độ đều chưa xong; đủ các ô 100% mới xong.

**Bằng chứng:** `DB09` FAIL trong [repository-observations.json](s6-round1/repository-observations.json).

### S6-06 — MEDIUM — Không biết buổi hiện tại nhưng tự gắn Buổi 11

**Vị trí:** `src/app/api/teaching-projects/route.ts:17–45`; `src/app/teaching-projects/page.tsx:253–262`.

**Tái hiện đã chạy:** lớp không có metadata danh sách lớp và không có lịch buổi trong SQLite; thay kết nối Teaching bằng bản giả để không ra mạng. GET `/api/teaching-projects` vẫn trả `currentSessionNumber: 11` do `return 11`. UI cũng có fallback 11. Như vậy nút có thể ghi “theo buổi hiện tại” và chọn 20% dù chưa biết buổi học.

**Cách sửa:** giữ trạng thái “chưa xác định buổi”, hướng dẫn quét lịch, khóa nút tự động theo buổi khi thiếu dữ liệu; các mốc thủ công vẫn có thể nằm trong Nâng cao. Không dùng 0% thay cho thông tin chưa biết để tránh vô tình đặt lại tiến độ.

**Kiểm lại:** Teaching có dự án nhưng chưa có lịch LMS → không có mốc tự nhận là Buổi 11; sau quét lịch thì mở đúng mốc.

**Bằng chứng:** `API01` trong [repository-observations.json](s6-round1/repository-observations.json), [source-excerpts.txt](s6-round1/source-excerpts.txt). Trong probe, 0 là giá trị biểu diễn “chưa biết”; phát hiện là tự khẳng định 11, không yêu cầu API bắt buộc dùng 0 thay vì null.

### S6-07 — MEDIUM — Trang chủ bị tạo cố định khi đóng gói, thẻ không theo dữ liệu mới

**Vị trí:** `src/app/page.tsx:19–76`; `src/lib/dashboard/today-tasks.ts:295`.

**Nguyên nhân:** Server Component đọc SQLite đồng bộ, nhưng không yêu cầu dựng trang theo từng lượt mở (`connection()` hoặc cấu hình dynamic tương đương). Hướng dẫn đi kèm bản Next.js đang cài tại `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/connection.md`, mục “Synchronous database drivers”, mô tả đúng trường hợp này.

**Tái hiện đã chạy, có ngoại lệ chẩn đoán:** bản dựng nguyên cấu hình bị chặn bởi lỗi TypeScript có sẵn ngoài S6 (ghi riêng bên dưới). Chỉ ở **bản sao TEMP**, bật `typescript.ignoreBuildErrors=true` để quan sát cách tạo Trang chủ; không đổi nguồn ứng dụng và không tính là production gate PASS. Seed lớp giả `VT-C4K-JSB88` ở Buổi 1 trước build. Sau build đổi SQLite và danh sách lớp giả sang Buổi 12, chạy `next start` chỉ bind `127.0.0.1`. GET `/` vẫn chứa link `sessionNumber=1`, không có link Buổi 12. `.next/prerender-manifest.json` xác nhận `/` được tạo tĩnh. Đã dừng máy chủ thử sau probe.

**Ảnh hưởng:** trong chế độ bản đóng gói, giáo viên có thể nhận hướng dẫn theo buổi/trạng thái cũ, kể cả tải lại trang. Môi trường phát triển không đủ để phát hiện lỗi này.

**Cách sửa:** buộc nội dung Trang chủ cần trạng thái hiện tại được đọc lại theo yêu cầu người dùng bằng cơ chế phù hợp bản Next.js cài trong dự án. Kiểm bằng bản dựng sạch sau khi xử lý lỗi build có sẵn; không giữ chế độ bỏ qua kiểm tra kiểu dữ liệu.

**Bằng chứng:** [production-observation.json](s6-round1/production-observation.json), [prerender-manifest.json](s6-round1/prerender-manifest.json), [HTML sau đổi DB](s6-round1/dashboard-production-after-db-change.html), [diagnostic-build-result.json](s6-round1/diagnostic-build-result.json). Ngoại lệ chỉ áp dụng bản sao cấu hình trong TEMP, đã khôi phục; không phải nghiệm thu production nguyên bản.

## Cổng đã chạy mới

Tất cả lệnh chạy test/probe đều được cấp trước ba biến: `ALLOWED_LOCAL_DIRS=$env:TEMP`, `MINDX_DB_PATH="$env:TEMP\codex_s6_r1.sqlite"`, `MINDX_RUNNING_CLASSES_PATH="$env:TEMP\codex_s6_r1_classes.json"`. Những bài cũ tự đổi sang đường dẫn riêng vẫn nằm trong bản sao dưới TEMP. Không sao chép `.env`, hai dữ liệu thật hoặc hồ sơ đăng nhập trình duyệt của Owner vào bản sao. Nhật ký và thời lượng: [gates.jsonl](s6-round1/gates.jsonl), [gate-retries.jsonl](s6-round1/gate-retries.jsonl), [execution-summary.json](s6-round1/execution-summary.json).

| Lệnh | Exit cuối | Kết quả |
| --- | --- | --- |
| `npx tsc --noEmit --incremental false` | 0 | PASS; workspace gốc chạy riêng cũng 0 |
| `npx tsx scripts/test-streamline-v340-s6.ts` | 0 | Đủ S6-T1–S6-T4 |
| `npx tsx scripts/test-phase5.ts` | 0 | PASS |
| `npx tsx scripts/test-phase6.ts` | 0 | PASS |
| `npx tsx scripts/test-phase7.ts` | 0 | Lượt đầu 1 vì bản sao thiếu `start-bot.bat/.command`; chép đúng hai tệp gốc vào TEMP, chạy lại đạt |
| `npx tsx scripts/test-phase4-codex-repros.ts` | 0 | PASS |
| `npx tsx scripts/test-spck-v270.ts` | 0 | PASS |
| `npx tsx scripts/test-spck-v272.ts` | 0 | PASS |
| `npx tsx scripts/test-lms-reliability-v280.ts` | 0 | PASS |
| `npx tsx scripts/test-session14-v290.ts` | 0 | PASS |
| `npx tsx scripts/test-teaching-project-v320.ts` | 0 | Đủ TP-01–TP-06, gồm chặn ghi sai task/student, hàng đợi và đọc lại tiến độ |
| `npx tsx scripts/test-report-card-v330.ts` | 0 | PASS |
| `npx tsx scripts/test-streamline-v340-s1.ts` | 0 | PASS |
| `npx tsx scripts/test-streamline-v340-s2.ts` | 0 | PASS |
| `npx tsx scripts/test-streamline-v340-s3.ts` | 0 | PASS |
| `npx tsx scripts/test-streamline-v340-s4.ts` | 0 | PASS |
| `npx tsx scripts/test-streamline-v340-s5a.ts` | 0 | Lượt đầu 1 vì thiếu lịch sử Git trong bản sao; cung cấp `GIT_DIR` chỉ cho các lệnh `git show`, chạy lại nguyên bài đạt 9/9 kịch bản |
| `npx tsx scripts/test-streamline-v340-s5.ts` | 0 | PASS |

### Quan sát build có sẵn — không quy thành lỗi mới của S6

Sau khi khắc phục trở ngại đường dẫn thư viện ở bản sao, build sạch bằng **`next build --webpack`** biên dịch được nhưng **exit 1** ở kiểm tra kiểu dữ liệu do bốn route xuất thêm hàm phụ: `sanitizeSpreadsheetCell`, `enqueueScrapeClassScores`, `computeReportCardStaleness`, `buildEnrichedSession14EvalList`. Bốn tệp đều giống HEAD sau chuẩn hóa xuống dòng: [production-errors-baseline.json](s6-round1/production-errors-baseline.json). Không coi 18 cổng PASS hay build chẩn đoán bỏ qua TypeScript là bằng chứng build production sạch.

Nhật ký build nguyên cấu hình: [production-build-physical-next.log](s6-round1/production-build-physical-next.log), [production-build-result.json](s6-round1/production-build-result.json). Các lượt trước lỗi do junction/thư mục thư viện vẫn được giữ riêng trong `production-build*.log`; không tính là lỗi mã S6. Bản sao chẩn đoán chỉ dùng xác minh `S6-07`.

## Bằng chứng UI và giới hạn

- Dùng **component thật**, esbuild và Chromium headless, CSS Tailwind/globals thật; các yêu cầu nghiệp vụ được thay bằng phản hồi giả, mọi truy cập mạng trình duyệt ngoài trang localhost giả đều bị chặn. Probe độc lập dùng một persistent BrowserContext tạm, thao tác tuần tự; không dùng `playwright-auth` thật.
- Đã kiểm query chọn đúng lớp ở Màn 5, chọn Buổi 14 ở Màn 3, chọn đúng lớp/Buổi 5 ở Nhận xét dù bộ nhớ trình duyệt lưu lớp khác; đã xác nhận `/homework-grader?...&autoScan=1` POST quét đúng lớp một lần và GET lại Phiếu điểm sau khi quét xong.
- [ui-observations.json](s6-round1/ui-observations.json), [repository-observations.json](s6-round1/repository-observations.json), [ui-probe.log](s6-round1/ui-probe.log), [repository-probe.log](s6-round1/repository-probe.log); mã probe đặt trong thư mục bằng chứng, **không phải `scripts/**`**.
- Ảnh đã kiểm: [Màn 5 Nâng cao](s6-round1/teaching-advanced.png), [lớp B còn kết quả A](s6-round1/class-B-stale-handoff.png), [Phiếu điểm tự quét](s6-round1/homework-autoScan.png), [Nhận xét query Buổi 5](s6-round1/comments-query-session5.png).
- Chưa nghiệm thu đăng nhập, đọc/ghi LMS/Teaching thật, lớp thật, tài khoản thật hoặc toàn bộ v3.4.0. Không có kết luận “bảo toàn hash DB Owner” vì tuyệt đối không đọc/băm hai tệp đó theo yêu cầu vòng này.

## Điều kiện kiểm lại và bàn giao

1. Sửa `S6-01` trước: khóa kết quả theo lớp/buổi, chặn hoàn toàn dùng kết quả A cho B.
2. Sửa `S6-02`–`S6-06`; thêm đối chứng vào bộ S6 để các lỗi đã tái hiện không lọt lại.
3. Sửa `S6-07` và kiểm bằng bản production sạch; xử lý riêng bốn lỗi build có sẵn trước nghiệm thu production.
4. Chạy lại cổng nền + S1–S6 và các probe thất bại với cùng ràng buộc dữ liệu giả; Reviewer Vòng 2 đối chiếu từng mã lỗi OPEN/CLOSED.

Đã cập nhật ba tài liệu tiến độ, giữ S6 **chưa được nghiệm thu**, không chuyển S7 và không tạo commit. Owner chưa cần thao tác với dữ liệu thật.
