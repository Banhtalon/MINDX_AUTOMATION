# Kiểm định độc lập v3.4.0 — S7 Round 1

Ngày: 2026-10-30. **Decision: NO-GO.**

Phạm vi: cây làm việc S7 trên HEAD `2364c93793a0b4805e435aa98ad0df7f00e91444`, không phải riêng nội dung đã commit. Đã đọc `PROJECT_STATE.md`, đối chiếu kế hoạch Giai đoạn 10/S7, `CHANGELOG.md`, `AGENTS.md` và mã liên quan. Không sửa mã ứng dụng, bài kiểm thử hiện có, `next-env.d.ts` hoặc hồ sơ round-12–round-41; không commit. Chỉ thêm hồ sơ vòng kiểm định này và cập nhật ba tài liệu trạng thái.

## Kết luận

Tám cổng bắt buộc đều đạt, nhưng probe độc lập có **116 quan sát: 102 đạt, 14 bất đạt**, thuộc **hai phát hiện OPEN (1 HIGH, 1 MEDIUM)**. Đã gọi mã thật của cả năm bộ sinh AI trên SQLite giả trong TEMP và bắt **20/20 payload** ngay tại ranh giới gọi AI. Kết quả chứng minh chưa đạt điều kiện “không lọt tên nào ra lời nhắn gửi AI”: bốn bộ sinh còn gửi nguyên tên trong tên file, bộ SPCK còn để sót tên một ký tự.

Các thiếu sót này là khoảng trống được giữ lại khi hợp nhất, không có đủ bằng chứng để quy là lỗi mới do S7 gây ra. Tuy nhiên chúng trực tiếp vi phạm điều kiện nghiệm thu S7.3 đã được yêu cầu. Không đóng S7 hoặc chuyển S8 trước khi sửa và kiểm lại.

## Gate Execution Summary

Các lệnh dưới đây chạy trên bản sao chỉ có mã nguồn trong `%TEMP%\mindx-s7-audit-5kut5_lz\`, mỗi cổng có thư mục riêng. Cả ba biến `ALLOWED_LOCAL_DIRS`, `MINDX_DB_PATH`, `MINDX_RUNNING_CLASSES_PATH` được đặt trước khi tiến trình bắt đầu; giá trị chính xác và thời gian nằm trong từng tệp JSON tại [s7-round1](s7-round1/). Không chép `.env`, hồ sơ đăng nhập, DB thật hoặc danh sách lớp thật. Những bài cũ tự đổi đường dẫn vẫn chỉ trỏ vào bản sao TEMP; tên `data/mindx_bot.db` trong bản sao không tồn tại, không phải tệp Owner.

| Lệnh | Exit code cuối | Bằng chứng |
|---|---:|---|
| `npx tsc --noEmit --incremental false` | 0 | `s7-round1/tsc.json`, `tsc.log` |
| `npx tsx scripts/test-streamline-v340-s7.ts` | 0 | `test-streamline-v340-s7.json`, `.log` |
| `npx tsx scripts/test-streamline-v340-s4.ts` | 0 | `test-streamline-v340-s4.json`, `.log` |
| `npx tsx scripts/test-phase4-codex-repros.ts` | 0 | `test-phase4-codex-repros.json`, `.log` |
| `npx tsx scripts/test-phase5.ts` | 0 | `test-phase5.json`, `.log` |
| `npx tsx scripts/test-phase7.ts` | 0 | `test-phase7.json`, `.log` |
| `npx tsx scripts/test-teaching-project-v320.ts` | 0 | `test-teaching-project-v320.json`, `.log` |
| `npx tsx scripts/test-report-card-v330.ts` | 0 | `test-report-card-v330.json`, `.log` |
| `npx tsx adversarial-probe.cjs` | 1 | `adversarial-probe.json`, `adversarial-results.json`: 102/116 đạt |
| `npx next build --webpack` | 0 | `production-build-native.json`, `production-build-native.log`: biên dịch, TypeScript và tạo trang hoàn tất |

Lệnh tái chạy probe từ workspace: `python docs/audits/v340/s7-round1/run-probe.py`; chương trình đặt biến môi trường, chép probe vào bản sao TEMP rồi chạy lệnh trên. Probe dùng mã thật của các bộ sinh, SQLite giả và hàm AI thay thế chỉ thu payload rồi dừng. Không gửi payload ra dịch vụ AI. Teaching dùng điểm chèn `mockAiExecutor` có sẵn. Các ca giao diện dùng React render với dữ liệu giả và hook thay thế; đây là bằng chứng HTML, không phải kiểm thử tương tác đầy đủ trong trình duyệt.

**Các lượt chạy công cụ không được bỏ qua:** Lượt đầu, TypeScript exit 0; bảy lệnh `tsx` exit 1 do bộ chặn socket của audit cũng chặn kênh IPC nội bộ của `tsx` (xem `*.attempt1.json`/`*.attempt1.log`). Đã cho phép named pipe/loopback, giữ chặn socket ra ngoài và chạy lại toàn bộ tám cổng, kết quả bảng trên. Khi dựng probe, hai lượt exit 2 do harness dùng API biên dịch không có trong TypeScript 7 và thiếu đối tượng `module` trong VM; đã sửa chính harness sang esbuild và chạy lại. Các điều kiện probe ban đầu về tên tệp JSON/tab và “chỉ đúng một token” cũng được chỉnh theo mã thật, không ghi thành lỗi sản phẩm.

**Build bổ sung:** Hai lượt `npx next build --webpack` đầu exit 1 do bản sao TEMP trên ổ C dùng junction thư viện trên ổ F: lượt một tạo đường dẫn `./F:/...` sai, lượt hai với `--preserve-symlinks` gây tách bộ nạp SWC. Không ghi hai lỗi này thành lỗi ứng dụng. Lượt cuối dùng bản sao vật lý hai gói `next`/`@next` ngay trong TEMP, các gói còn lại dùng junction; **exit 0, 51,67 giây**, hoàn tất biên dịch, kiểm TypeScript và tạo trang. Không sửa nguồn/cấu hình hoặc bỏ qua kiểm tra kiểu dữ liệu. Xem `production-build.attempt1.*`, `production-build.*`, `production-build-native.*` và `build-native.py`. Việc chuẩn bị bản sao vật lý có một lần dừng vì workspace không có thư mục `public`; đã sửa harness để bỏ qua thư mục không tồn tại, rồi chạy thành công.

Các lệnh chuẩn bị/đối chiếu chỉ đọc gồm `git rev-parse HEAD`, `git status --short`, `git diff --stat`, `git diff --numstat`, `git diff -- src/...`, `rg` tìm các mẫu cần kiểm, đọc tài liệu/mã nguồn, và `Get-FileHash` trước/sau. Trình điều phối: `python docs/audits/v340/s7-round1/run-audit.py`; probe: `python docs/audits/v340/s7-round1/run-probe.py`; build: `python docs/audits/v340/s7-round1/build-native.py`; không thêm `.ts` vào hồ sơ audit.

## Finding Table

| ID | Severity | Status | Vị trí chính xác | Bằng chứng tái hiện | Cách sửa bắt buộc |
|---|---|---|---|---|---|
| **S7-01** | **HIGH** | **OPEN** | `src/lib/ai/pii-anonymizer.ts:479`, `:498`, `:575`; `src/lib/gemini/homework-grader.ts:116` | `comment/homework/session14/teaching-{2,3}-privacy`: cả 8 ca có nguyên `Nguyen_Minh_Khoi`, `Tran_Minh_Khoi`, `Le_Thi_Y`, `Pham_Van_Y` hoặc dạng viết liền tương ứng trong payload bắt tại ranh giới AI. | Áp dụng xử lý tên nối/viết liền thống nhất cho cả năm điểm gọi, bao gồm tên bản thân và bạn cùng lớp; giữ token hiện có. Thêm kiểm thử bắt payload thực tế của từng bộ sinh, không chỉ kiểm tra có import helper. |
| **S7-02** | **MEDIUM** | **OPEN** | `src/lib/ai/pii-anonymizer.ts:223`, `:231`, `:352`, `:362` | `joined-Lê Thị Ý-`, `joined-Lê Thị Ý-_`, hai ca tương ứng cho `Phạm Văn Y`, cùng `spck-{2,3}-one-char-filename`: `LeThiY.py` → `STUDENT_01Y.py`; `Le_Thi_Y.py` → `STUDENT_01_Y.py`; payload SPCK có `STUDENT_PEER_Y.py`. | Không bỏ tên một ký tự khỏi chuỗi họ tên dùng để nhận diện tên file. Thay cả chuỗi tên đã xác định, kể cả Ý/Y/Á/Ỷ/Ứ; không tùy tiện xóa mọi biến một ký tự trong code. Kiểm cả bản thân/bạn cùng lớp, dấu/không dấu và dấu nối. |

**S7-01 — Nguyên nhân và luồng ảnh hưởng.** `replaceWholePhrase` tại `pii-anonymizer.ts:82` coi `_` là ranh giới cấm; tên viết liền cũng không khớp cụm từ. Cơ chế riêng `matchJoinedFileNames` ở dòng 215 chỉ được bật trong wrapper SPCK, trong khi wrapper nhận xét buổi học, tổng kết Buổi 14, Teaching và `HomeworkAiGrader.buildNameScrubber` không bật. Vì thế ghi chú giáo viên hoặc nội dung code có tên file vẫn đưa tên nhận diện đầy đủ sang AI. Những ví dụ này đều dùng tên giả.

Các điểm xác nhận gửi payload: `comment-generator.ts:601`, `homework-grader.ts:450`, `session14-course-summary.ts:643`, `spck-comment.ts:736`; Teaching bắt prompt tại `mockAiExecutor` của chính hàm `generateTeachingProjectTasksWithAI`. Toàn bộ 20 kiểm tra “boundary” đều đạt; ca privacy bất đạt không phải vì chưa đi tới hàm AI.

**S7-02 — Nguyên nhân.** Nhánh tên file lọc thành phần bằng `length >= 2`, nên `Y`/`Ý` bị bỏ khỏi mẫu ghép họ tên. Thay họ và tên đệm để lại ký tự cuối dính vào token hoặc sau `_`; nhánh thay từng từ cũng bỏ qua ký tự đó. Các ca tên một ký tự đứng riêng trong câu bình thường đã đạt, nhưng không bao phủ tên file. Đây là lý do không thể dùng kết quả kiểm tên đứng riêng để đóng lỗi này.

## Các phần đã xác nhận đạt

- **S7.1:** Component cũ đã xóa, bốn kiểu dữ liệu đã chuyển sang `src/lib/types/index.ts`, bộ Phase 5 vẫn đạt. Không có import hỏng được TypeScript phát hiện.
- **S7.2:** React render xác nhận năm link chính, Cài đặt đứng sau `</nav>` cạnh nút đổi màu, hai tab Giáo trình/Quick Tags hiện được với dữ liệu giả và không còn tab Barem/Mẫu Zalo. Hai tệp `grading_rubrics.json`, `zalo_templates.json` vẫn có và không có diff so với HEAD. HTML tại `rendered-html.json`.
- **S7.3 một phần:** Đạt tên đầy đủ, cụm hai từ, tên gọi, không dấu, Unicode tổ hợp, tên trùng trong danh sách, tên bạn và vòng ẩn danh/khôi phục tên đầy đủ. Các ca tên trùng chỉ xác nhận che tên/quy tắc chọn token ổn định; tên gọi trùng tự nó không đủ xác định đúng người. Tên file còn hai lỗi trong bảng.
- **S7.4:** Hàm giữ dấu trả `lê bảo an` và phân biệt `lê bá an`; hai hàm bỏ dấu trả đúng `dang thi y`/`DANG Thi Y`, kể cả Unicode tổ hợp. Không còn lời gọi `.normalize("NFD")` ngoài `vietnamese-match.ts` trong mã nguồn; hai lời gọi trong tệp chung là chủ đích.
- **S7.6:** Quét độc lập `src/` không còn khối `{false && ...}` hoặc `Boolean(0)`.
- **S7.5:** Bỏ qua theo kế hoạch đã duyệt, không phải lỗi hoặc việc bắt buộc còn thiếu.

## Production Data Preservation Check

Hai lần băm chỉ dùng lệnh được Owner cho phép: `Get-FileHash -Algorithm SHA256 -LiteralPath 'data/mindx_bot.db', 'data/running_classes.json'`. Không mở kết nối SQLite, sao chép hoặc đọc nội dung vận hành của hai tệp này. Giá trị trước audit khớp chính xác hai mã kỳ vọng Owner cung cấp.

| Tệp | SHA-256 trước | SHA-256 sau | Kết quả |
|---|---|---|---|
| `data/mindx_bot.db` | `A911EB02CD6E2610340604DCF42D53AFB428C50C02727C4CE44F138DEC9C8F16` | `A911EB02CD6E2610340604DCF42D53AFB428C50C02727C4CE44F138DEC9C8F16` | Giữ nguyên |
| `data/running_classes.json` | `ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2` | `ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2` | Giữ nguyên |

Đối chiếu manifest xác nhận **1.999/1.999 tệp được bảo vệ giữ nguyên**: 122 tệp nguồn, 23 tệp script hiện có, `next-env.d.ts` và 1.853 tệp hồ sơ round-12–round-41. Xem `protected-before.json`, `preservation.json`, `production-after.json`. Những thay đổi S7 đã có trước audit, gồm thay đổi sẵn ở `next-env.d.ts`, được giữ nguyên; không hoàn tác về HEAD.

## Giới hạn và việc tiếp theo

Chưa nghiệm thu LMS/Teaching/Gemini thật, trình duyệt ứng dụng đầy đủ hoặc toàn bộ v3.4.0. Không chạy lại bộ chờ trình duyệt chậm `test-session14-v290.ts` theo phạm vi Owner yêu cầu. Việc bắt payload chứng minh nội dung mà mã chuẩn bị gửi, không chứng minh phản hồi AI hay ghi lên dịch vụ thật.

Sửa tối thiểu hai mục trong bảng ở bộ ẩn danh chung/các wrapper, mở rộng kiểm thử payload của năm bộ sinh và kiểm lại S7 Round 2. Giữ nguyên cách tính điểm, trạng thái duyệt, quy tắc Checkpoint, cơ sở dữ liệu và phần giao diện đã đạt. Owner chưa cần thao tác thủ công.
