Verdict: NO-GO

# Kiểm định độc lập v3.4.0 — Chặng S6, Vòng 2

- Ngày: **2026-10-30**. Reviewer: **Codex độc lập**, theo cấu hình Owner yêu cầu `gpt-6.1-sol`, `high`.
- Mốc kiểm: HEAD **`2ce97352959be286aecb87d8371c70ea6a4fb484` cộng cây mã S6 và bản sửa chưa commit**. Không áp dụng kết luận riêng cho HEAD. Nguồn được chốt bằng [source-before.json](s6-round2/source-before.json), [working-tree.patch](s6-round2/working-tree.patch), [reviewed-untracked](s6-round2/reviewed-untracked/) và [git-status-before.txt](s6-round2/git-status-before.txt).
- Đã đối chiếu `PROJECT_STATE.md`, `AGENTS.md`, `MINDX_AUTOMATION_PLAN.md`, `CHANGELOG.md`, [Vòng 1](CODEX_S6_ROUND1.md) và mục S6.1–S6.6/Q4 trong [kế hoạch được duyệt](s6-round2/approved-plan.source.md).
- Phạm vi: ứng dụng cục bộ cho một giáo viên; kiểm đổi lớp/buổi, sửa nội dung sau nộp và dữ liệu học viên thiếu/cũ. Toàn bộ dữ liệu chạy thử là giả lập.

## Kết quả chính

**Đóng 4/7 phát hiện: `S6-01`, `S6-05`, `S6-06`, `S6-07`. Còn 3 phát hiện MEDIUM sửa một phần: `S6-02`, `S6-03`, `S6-04`.** Biểu hiện lỗi HIGH đổi lớp A → B ở Vòng 1 không còn tái hiện. Chưa đủ điều kiện đóng S6 hoặc chuyển S7.

**18/18 cổng đạt kết quả cuối**; lượt đầu 17/18. Bộ Teaching v320 lượt đầu lỗi Windows `EPERM` khi dọn thư mục trình duyệt tạm ở TP-06; chạy lại nguyên bài, không sửa test, đạt TP-01–TP-06. TypeScript tại workspace sau khi hoàn thiện bố trí bằng chứng cũng **PASS**.

**54 quan sát độc lập: 41 đạt, 13 bất đạt**, gồm 34 quan sát Chromium (24 đạt/10 bất đạt) và 20 quan sát dữ liệu/API (17 đạt/3 bất đạt). Các ca bất đạt thuộc ba nhóm còn mở, không phải 13 lỗi riêng. Thêm **1 quan sát production chẩn đoán đạt** xác nhận Trang chủ đổi dữ liệu giữa hai request. Mã thoát 0 của probe ghi đo chỉ xác nhận đã chạy hết; kết quả từng ca nằm ở `expected`, `actual`, `pass` trong JSON.

**142/142 tệp `src/**` và `scripts/**`, cùng `next-env.d.ts` giữ nguyên**; bản sao chạy test cũng khớp các hash này. Không mở, băm, sao chép hoặc kết nối tới `data/mindx_bot.db` hay `data/running_classes.json` thật. Không dùng hồ sơ đăng nhập, không gọi LMS/Teaching thật, không commit. [Bằng chứng nguồn giữ nguyên](s6-round2/source-integrity.json).

## Đối chiếu từng phát hiện Vòng 1

| Mã | Trạng thái Vòng 2 | Kết quả xác minh |
| --- | --- | --- |
| S6-01 — HIGH | **CLOSED** trong phạm vi đã thử | Kết quả combo có `classId`; hook đặt lại combo khi đổi lớp/buổi. A hoàn tất → B chưa nộp: không nút 100%, không link Phiếu điểm, không POST cho B; phản hồi cập nhật A đến muộn không hiện ở B. Đổi 14 → 12 → 14 không khôi phục gợi ý cũ. `UI06`–`UI09`, `R2-UI30`–`R2-UI32` đạt. |
| S6-02 — MEDIUM | **OPEN — sửa một phần** | Ca gốc “S1 thành công ngoài đợt còn S2 FAILED” đã chặn đúng (`UI13`). Nhưng khi không còn dòng được ghép, mã quay lại dùng thống kê đợt cũ; thao tác thật bỏ ghép cả hai dòng sau combo vẫn giữ nút 100% và link. Chi tiết bên dưới. |
| S6-03 — MEDIUM | **OPEN — sửa một phần** | SPCK bẩn và đánh giá một phần trước combo đã chặn (`UI10`–`UI12`). Sau combo, bản nháp/đánh giá lỗi hoặc sửa thư vẫn không làm ẩn link. Việc so số lượng cũng chưa đối chiếu đúng ID học viên. |
| S6-04 — MEDIUM | **OPEN — sửa một phần** | Đã chặn thiếu bản ghi của học viên active; đã bỏ qua `ABSENT` cho Nhận xét. Tuy nhiên lấy hợp của active và mọi ID có bản ghi cũ khiến học viên inactive vẫn chặn cả Nhận xét, SPCK và Đánh giá. |
| S6-05 — MEDIUM | **CLOSED** | `Math.floor` ở phép tính trung bình và chuẩn hóa tiến độ; 99,9% không hoàn tất, thiếu khóa chưa xong, đủ 100% mới xong. `DB09`, `R2-DB18`, `R2-DB19` đạt. |
| S6-06 — MEDIUM | **CLOSED** | API thiếu lịch trả `currentSessionNumber=0`; UI fallback 0; mapper trả `isKnownSession=false`; nút 1 chạm bị khóa. `API01`, `R2-UI23`, `R2-UI24` đạt. |
| S6-07 — MEDIUM | **CLOSED về mã và bằng chứng chẩn đoán** | Có đúng `dynamic="force-dynamic"`, `revalidate=0`; `/` không có trong manifest tạo tĩnh. Cùng một máy chủ thử: request đầu thấy Buổi 12, đổi dữ liệu giả, request sau thấy Buổi 14. Build production sạch vẫn bị chặn bởi lỗi có sẵn ngoài S6; không nâng bằng chứng này thành nghiệm thu production. |

## Ba thiếu sót còn mở

### S6-02 — MEDIUM — Không còn bài đang ghép nhưng kết quả cũ vẫn mở gợi ý

**Vị trí:** `src/components/final-project/SubmitBar.tsx:60–64, 109–123, 160–174`; đường thao tác thực tế: `src/components/final-project/StudentRow.tsx:197–223`.

**Nguyên nhân:** khi `assignedRows.length === 0`, hai bộ đếm quay về `activeSummary.verifiedItems` và `retryStudentIds`. Các dòng đã bỏ ghép có `isDirty=true` nhưng bị lọc khỏi `assignedRows` và `dirtyStudentIds`, nên kết quả đợt cũ lại được coi là bằng chứng hiện tại.

**Tái hiện đã chạy trên trang thật với phản hồi API giả:** nộp đủ hai học viên Buổi 14 → hai phần thành công → dùng hai hộp chọn học viên đổi về `-- Ghép học viên --`. Cả hai dòng hiện thiếu học viên, nhưng vẫn còn nút **“Cập nhật tiến độ Teaching lên 100%”** và link **“Mở Phiếu điểm → Quét”**. Không có bài hiện tại đủ điều kiện để chứng minh hoàn tất. Không gửi tiến độ lên dịch vụ thật.

**Bằng chứng:** `R2-UI27` xác nhận đúng hai hộp chọn; `R2-UI28`, `R2-UI29` bất đạt trong [ui-observations.json](s6-round2/ui-observations.json); [ảnh thao tác bỏ ghép](s6-round2/unassigned-rows-stale-handoff.png), [nội dung UI](s6-round2/unassigned-ui.txt). Đối chứng mount component thật `R2-UI21` cũng bất đạt. Ca gốc `UI13` đã đạt, vì vậy không kết luận bản sửa hoàn toàn không có tác dụng.

**Cách sửa nhỏ nhất:** điều kiện mở gợi ý cần tập bài hiện tại không rỗng và tất cả bài thuộc phạm vi đều `VERIFIED_CURRENT`, sạch, không retry. Không dùng thống kê đợt nộp thay thế bằng chứng hiện tại khi tập bài rỗng hoặc đang bị đổi ghép. Kết quả đợt cũ vẫn có thể được giữ để trình bày lịch sử.

**Sau khi sửa:** thêm ca nộp đủ → bỏ ghép toàn bộ → không có hai gợi ý; giữ các đối chứng mọi bài VERIFIED thì mở, còn một FAILED/DRAFT/dirty thì khóa.

### S6-03 — MEDIUM — Combo cũ che đánh giá đã sửa hoặc không còn VERIFIED

**Vị trí:** `src/components/final-project/SubmitBar.tsx:129–157, 166–174`; sửa thư trực tiếp tại `src/components/final-project/StudentRow.tsx:1121–1137` và các ô thư kế tiếp; kết quả combo được giữ tại `src/components/final-project/useSpckWorkflow.ts:3598–3608`.

**Nguyên nhân:** khi có combo đúng lớp, số đánh giá thành công lấy từ `session14ComboStatus.evalVerifiedCount`. Nhánh tính số chưa xong không dùng trạng thái đánh giá hiện tại; ID đã VERIFIED ở combo cũng được dùng để bỏ qua bản ghi không còn VERIFIED. `Math.max(số SPCK, số đánh giá)` chỉ so số lượng, không chứng minh hai phần thuộc cùng tập học viên. Ngoài ra, khi giáo viên gõ lại thư, `onChange` cập nhật nội dung nhưng chưa hạ trạng thái ngay trước khi rời ô.

**Tái hiện đã chạy:**

1. Trang `/final-project` thật, hai phần Buổi 14 thành công; mở Tab 2 của một học viên rồi sửa thư. Link Phiếu điểm vẫn còn ngay khi đang gõ (`R2-UI25`). Rời ô, API giả trả bản ghi mới `WAITING_APPROVAL`, xóa hash; link vẫn còn (`R2-UI26`).
2. Mount `SubmitBar` thật với hai SPCK sạch/VERIFIED và combo cũ xác minh hai người. Lần lượt cho đánh giá S2 là `DRAFT`, `WAITING_APPROVAL`, `FAILED`, hoặc thiếu hẳn đánh giá S2: link vẫn xuất hiện (`R2-UI19-*`, `R2-UI20`). Đối chứng cả hai đánh giá hiện tại VERIFIED thì mở đúng (`R2-UI18`).
3. SPCK là S1/S2 nhưng đánh giá VERIFIED là S1/S3, combo idle: link vẫn xuất hiện (`R2-UI22`). Đây là đối chứng component cho phép kiểm theo ID, không phải kết luận đã xảy ra ở dữ liệu Owner.

**Bằng chứng:** [ui-observations.json](s6-round2/ui-observations.json), [ảnh trang sau sửa thư](s6-round2/edited-eval-full-page.png), [nội dung trang](s6-round2/edited-eval-ui.txt), [ảnh component khi đánh giá chờ duyệt](s6-round2/stale-combo-edited-eval.png).

**Cách sửa nhỏ nhất:** kiểm từng `studentId` bắt buộc ở cả hai phần hiện tại; đánh giá thiếu hoặc khác `VERIFIED` phải chặn link, bất kể bộ đếm combo cũ. Khi sửa nội dung/điểm đánh giá, đánh dấu chưa nộp ngay trong bộ nhớ UI hoặc đối chiếu bản đã xác minh, không chờ rời ô. Giữ kết quả combo để báo lịch sử/thử lại, không dùng nó che bản sửa mới.

**Sau khi sửa:** toàn bộ `R2-UI19-*`, `R2-UI20`, `R2-UI22`, `R2-UI25`, `R2-UI26` phải không có link; ca đủ đúng hai phần vẫn có link mang đúng lớp và `autoScan=1`.

### S6-04 — MEDIUM — Học viên đã nghỉ vẫn chặn thẻ “Việc cần làm hôm nay”

**Vị trí:** `src/lib/dashboard/today-tasks.ts:358–370, 409–417, 447–452`.

**Nguyên nhân:** tuy đã đọc danh sách `students WHERE isActive=1`, mã tiếp tục lấy hợp danh sách đó với mọi ID trong bảng Nhận xét/SPCK/Đánh giá. Vì thế bản ghi cũ của người đã nghỉ lại trở thành yêu cầu bắt buộc.

**Tái hiện trên SQLite giả:** S1 active và VERIFIED đầy đủ; S2 inactive nhưng còn lần lượt Nhận xét PRESENT/DRAFT, SPCK FAILED, Đánh giá DRAFT. Cả ba mục vẫn báo chưa xong. Chỉ xóa bản ghi cũ của S2 trong dữ liệu giả, không thay kết quả S1, thì cả ba mục đổi sang hoàn tất.

**Bằng chứng:** `R2-DB12`–`R2-DB14` bất đạt, đối chứng `R2-DB15`–`R2-DB17` đạt trong [repository-observations.json](s6-round2/repository-observations.json). Ca thiếu dòng active và ca `ABSENT` gốc đều đã đạt (`DB01`, `DB04`, `DB07`, `DB11`).

**Cách sửa nhỏ nhất:** lấy tập học viên active làm danh sách bắt buộc và tra bản ghi theo ID; với Nhận xét tiếp tục loại active `ABSENT`. Không thêm người inactive hoặc ID ngoài danh sách vào tập bắt buộc chỉ vì còn dữ liệu lịch sử. Nếu cần hỗ trợ kho cũ chưa có danh sách học viên, xử lý rõ trạng thái thiếu danh sách, không trộn âm thầm với danh sách hiện tại.

**Sau khi sửa:** thiếu dòng active vẫn chưa xong; inactive còn DRAFT/FAILED không chặn; ABSENT không chặn Nhận xét; active có mặt và đủ VERIFIED mới hoàn tất.

## Đối chiếu toàn bộ S6.1–S6.6

| Hạng mục | Kết quả | Bằng chứng / giới hạn |
| --- | --- | --- |
| S6.1 — Màn 5 một nút, mốc theo buổi, Nâng cao | **Đạt cục bộ** | Cổng S6-T1/T4 kiểm ánh xạ và POST đúng lớp/mốc; `UI01`–`UI03` kiểm chọn lớp, thu/mở Nâng cao; thiếu buổi khóa nút (`R2-UI23/24`). |
| S6.2 — Gợi ý cập nhật sau VERIFIED | **Chưa đạt trọn vẹn** | Đổi lớp và còn bài lỗi trong tập hiện tại đã chặn; còn `S6-02` khi tập ghép rỗng. Route tiến độ dùng dịch vụ xếp hàng/đọc lại có sẵn; Teaching v320 TP-01–TP-06 đạt cuối. Không ghi Teaching thật. |
| S6.3 — Buổi 14 → Phiếu điểm → Quét | **Chưa đạt điều kiện hiển thị** | Còn `S6-03`. Link đúng lớp; `UI14/15` xác nhận quét đúng lớp một lần và tải lại Phiếu điểm sau quét. |
| S6.4 — Việc cần làm hôm nay | **Chưa đạt trọn vẹn** | Đã sửa thiếu dòng active, ABSENT, làm tròn và trang tĩnh; còn inactive (`S6-04`). Bộ S6 kiểm các buổi 1/5/7/11/12/14; probe kiểm Robotics Buổi 4, mở Nhận xét đúng lớp/Buổi 5 dù bộ nhớ cũ lưu lớp khác (`UI16/17`). |
| S6.5 — Bỏ hành động thừa/khối chết | **Đạt** | S6-T3: `approve`/`approve_and_save` HTTP 400, `save_draft` hoạt động; hai trang không còn `{false && ...}`. Hồi quy v320 đạt. |
| S6.6 — Bộ kiểm thử S6 và cổng nền | **Đã có/chạy đạt; chưa đủ chứng minh GO** | Có bổ sung ca thiếu dòng active, ABSENT, 99,9%, thiếu buổi và cấu hình dynamic. Chưa chặn các ca hiện tái hiện: bỏ ghép toàn bộ, sửa đánh giá sau combo, inactive còn dữ liệu cũ. Cần đưa các ca này vào bài hồi quy sau khi sửa. |

## Cổng chạy mới và môi trường cô lập

Trước các tiến trình test/probe đã cấp ba biến sau; runner cũng cấp lại cho từng bài. Một số bài tự chuyển sang đường dẫn riêng nhưng vẫn trong TEMP/bản sao TEMP:

```powershell
$env:ALLOWED_LOCAL_DIRS = $env:TEMP
$env:MINDX_DB_PATH = "$env:TEMP\codex_s6_r2.sqlite"
$env:MINDX_RUNNING_CLASSES_PATH = "$env:TEMP\codex_s6_r2_classes.json"
```

Không sao chép `.env`, dữ liệu vận hành hoặc hồ sơ đăng nhập Owner vào bản sao. Chạy bài nguyên bản trong bản sao nguồn dưới TEMP, dùng thư viện đã cài; không cài lại môi trường. `GIT_DIR`/`GIT_WORK_TREE` chỉ được cấp cho bài S5a cần `git show` đọc mốc cũ.

| Lệnh | Exit cuối | Kết quả |
| --- | --- | --- |
| `npx tsc --noEmit --incremental false` | 0 | PASS trong bản sao; workspace cuối cũng 0 |
| `npx tsx scripts/test-streamline-v340-s6.ts` | 0 | S6-T1–S6-T4 PASS |
| `npx tsx scripts/test-phase5.ts` | 0 | PASS |
| `npx tsx scripts/test-phase6.ts` | 0 | PASS |
| `npx tsx scripts/test-phase7.ts` | 0 | PASS |
| `npx tsx scripts/test-phase4-codex-repros.ts` | 0 | PASS |
| `npx tsx scripts/test-spck-v270.ts` | 0 | PASS |
| `npx tsx scripts/test-spck-v272.ts` | 0 | PASS |
| `npx tsx scripts/test-lms-reliability-v280.ts` | 0 | PASS |
| `npx tsx scripts/test-session14-v290.ts` | 0 | PASS |
| `npx tsx scripts/test-teaching-project-v320.ts` | 0 | Chạy lại nguyên bài sau EPERM dọn TEMP, TP-01–TP-06 đạt |
| `npx tsx scripts/test-report-card-v330.ts` | 0 | PASS |
| `npx tsx scripts/test-streamline-v340-s1.ts` | 0 | PASS |
| `npx tsx scripts/test-streamline-v340-s2.ts` | 0 | PASS |
| `npx tsx scripts/test-streamline-v340-s3.ts` | 0 | PASS |
| `npx tsx scripts/test-streamline-v340-s4.ts` | 0 | PASS |
| `npx tsx scripts/test-streamline-v340-s5a.ts` | 0 | PASS, đủ dữ liệu launcher/lịch sử Git đọc trước khi chạy |
| `npx tsx scripts/test-streamline-v340-s5.ts` | 0 | PASS |

Nhật ký: [gates.jsonl](s6-round2/gates.jsonl), [Teaching lần đầu](s6-round2/test-teaching-project-v320.log), [Teaching chạy lại](s6-round2/test-teaching-project-v320.rerun.log), [TypeScript workspace cuối](s6-round2/tsc-workspace.log), [tổng hợp](s6-round2/execution-summary.json).

### Build sạch và xác minh riêng S6-07

`next build --webpack` nguyên cấu hình trong bản sao TEMP biên dịch được nhưng **exit 1** ở bốn route xuất hàm phụ không hợp lệ: `sanitizeSpreadsheetCell`, `enqueueScrapeClassScores`, `computeReportCardStaleness`, `buildEnrichedSession14EvalList`. Bốn tệp giống HEAD sau chuẩn hóa xuống dòng; đây vẫn là trở ngại có sẵn ngoài S6, không ghi thành lỗi mới. [Log build sạch](s6-round2/production-build-physical-next.log), [kết quả](s6-round2/production-build-result.json), [đối chiếu HEAD](s6-round2/production-errors-baseline.json).

Chỉ để kiểm `S6-07`, ở bản sao cấu hình TEMP bật `typescript.ignoreBuildErrors=true`, giữ nguyên toàn bộ nguồn ứng dụng. Build chẩn đoán exit 0; chạy máy chủ chỉ trên `127.0.0.1`, request đầu sau cập nhật fixture thấy Buổi 12, đổi fixture sang Buổi 14, request tiếp thấy Buổi 14 và không còn liên kết SPCK Buổi 12. `/` không còn được tạo tĩnh. Đã dừng máy chủ và trả cấu hình bản sao về nguyên bản. **Không coi đây là build production sạch.** [Quan sát](s6-round2/production-observation.json), [manifest](s6-round2/prerender-manifest.json), [HTML lượt đầu](s6-round2/dashboard-production-after-db-change.html), [HTML lượt sau](s6-round2/dashboard-production-second-request.html), [log chẩn đoán](s6-round2/diagnostic-build.log).

### Tính tin cậy của probe và giới hạn

- Dùng component/trang thật, Chromium với một persistent context tạm, thao tác tuần tự, CSS ứng dụng thật; phản hồi nghiệp vụ giả, mạng trình duyệt ngoài trang localhost giả bị chặn. Probe dữ liệu dùng SQLite giả và thay dịch vụ tải Teaching bằng hàm giả. Mã nằm trong thư mục bằng chứng, không ở `scripts/**`.
- Lượt dựng probe ban đầu có bộ chọn nhãn bị mất dấu do truyền Unicode qua PowerShell; đã sửa bộ chọn trong **probe**, thêm đối chứng dương và chạy lại nguyên luồng. Một lượt bổ sung chọn sai nút mở Tab 2 hết thời gian chờ; đã dùng đúng nút trên component thật và chạy lại. Chỉ JSON/log cuối là kết quả dùng kết luận. [Log thử ban đầu còn lưu](s6-round2/ui-probe.debug.log).
- TypeScript workspace lần đầu bị các **bản chụp bằng chứng** mang đuôi `.ts` tham gia biên dịch. Đổi riêng các bản chụp đó sang `.ts.txt`, không sửa `tsconfig`, nguồn hoặc test; chạy lại TypeScript nguyên lệnh đạt. [Log lượt đầu](s6-round2/tsc-workspace.initial-evidence-layout.log). Bản sao chạy cổng không gặp lỗi này.
- Đo liên kết production dùng ranh giới đầy đủ để `sessionNumber=1` không khớp nhầm `sessionNumber=12`; JSON cuối đã đối chiếu HTML lưu trên đĩa.
- Chưa nghiệm thu lớp/tài khoản/LMS/Teaching/Gemini thật, chưa có build production sạch và chưa nghiệm thu toàn bộ v3.4.0. Không tuyên bố bảo toàn hash DB Owner, vì hai tệp thật tuyệt đối không được đọc/băm.

## Bàn giao sửa và kiểm lại

1. **S6-02:** bỏ cách dùng thống kê cũ để mở gợi ý khi không còn tập bài hiện tại hợp lệ; kiểm ca bỏ ghép toàn bộ sau combo.
2. **S6-03:** khóa link theo đúng ID và trạng thái hiện tại của cả hai phần; đánh dấu đánh giá đã đổi ngay khi gõ; combo cũ không được phủ bản DRAFT/FAILED hoặc đánh giá thiếu.
3. **S6-04:** dùng danh sách active làm tập bắt buộc, không lấy hợp với người đã nghỉ; tiếp tục xử lý `ABSENT` theo quy tắc Nhận xét.
4. Bổ sung hồi quy cho ba nhóm, chạy lại cổng nền/S1–S6 và probe tương ứng trong TEMP; kiểm định Vòng 3 trên đúng nguồn sau sửa. Xử lý riêng bốn lỗi build trước nghiệm thu production.

Đã cập nhật ba tài liệu trạng thái, giữ S6 **chưa nghiệm thu**. Owner chưa cần thao tác với tài khoản hoặc dữ liệu thật.
