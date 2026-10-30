# Kiểm định độc lập v3.4.0 — S3, Round 1

**Decision: NO-GO**

Ngày kiểm định: 30/10/2026. Phạm vi: cây làm việc so với `ab3f570e57c908bf5d19e3df10a563efc45616f6` (HEAD cũng ở commit này), S3.1–S3.8. Người kiểm định: Codex, vai trò Independent Quality & Safety Auditor theo prompt của Owner. Không sửa mã ứng dụng, bộ kiểm thử sẵn có hoặc dữ liệu thật.

S3 rút gọn thao tác điểm danh, soạn nhận xét, duyệt và đẩy LMS; đồng thời dùng chung bộ tạo thông báo Zalo. Luồng thuận chạy được, nhưng **6 nhóm vấn đề còn OPEN**: 3 HIGH, 2 MEDIUM, 1 LOW. Đặc biệt, bản mới có thể duyệt/yêu cầu đẩy nhận xét cũ sau lỗi lưu hoặc khi giáo viên tiếp tục sửa trong lúc duyệt. **15/15 cổng bắt buộc có lượt chạy mới cuối cùng exit 0 không đủ để cho GO:** bộ dò độc lập có **12/23 kiểm tra PASS, 11 FAIL** thuộc sáu nhóm bên dưới.

## 1. Căn cứ và phạm vi

- Đã đọc `PROJECT_STATE.md` trước, đối chiếu Giai đoạn 10 trong `MINDX_AUTOMATION_PLAN.md`, `CHANGELOG.md`, `AGENTS.md` và các file nguồn được nêu trong prompt. Tài liệu hiện đánh dấu S2 GO và S3 đang triển khai, chưa tự công nhận S3 hoàn tất.
- Đọc cả các đường nối liên quan: `sqlite.ts`, `save-lms/route.ts`, `save-comments.ts`, bộ cấu hình Zalo, bộ kiểm tra nguồn yêu cầu nội bộ và các bộ test. Lưu fingerprint bảy file S3 trong [reviewed-source-sha256.json](s3-round1/reviewed-source-sha256.json).
- Giả định sử dụng: một giáo viên trên máy cục bộ, có thể gõ tiếp hoặc mở nhiều tab khi yêu cầu đang chờ; các tình huống phản hồi chậm, đến ngược thứ tự và thất bại từng phần nằm trong phạm vi.
- Dùng phương pháp của skill `ponytail-review`: lần theo cả bên gọi/bên nhận và chỉ báo lỗi có tình huống cụ thể. `team-workflow` được đối chiếu về cách kiểm định và báo cáo. Không có công cụ/model Claude Reviewer trong phiên; không gán bằng chứng của lượt này cho Claude hoặc một reviewer khác.
- Không sửa ba tài liệu trạng thái/kế hoạch/changelog trong lượt kiểm định này; không đánh dấu S3 GO. Chỉ bổ sung báo cáo và bằng chứng kiểm định mới.

## 2. Gate Execution Summary

`SWC` trong bảng nghĩa là chạy nguyên file test bằng `node <TEMP>/loader.cjs scripts/<suite>.ts`, loader dùng `@next/swc-win32-x64-msvc`, `require.extensions` và `Module._resolveFilename`. Đây là cách thực thi chính thức được prompt cho phép, không phải kết quả suy ra từ đọc mã. Các lượt này chạy trong bản sao workspace ở TEMP. `tsx` chạy từ checkout gốc với dữ liệu thử ở TEMP; riêng Phase 7 luôn chạy trong bản sao TEMP.

| Lệnh yêu cầu | Cách thực thi của kết quả cuối | Exit code | Bằng chứng |
|---|---|---:|---|
| `npx tsc --noEmit --incremental false` | `npx --no-install tsc --noEmit --incremental false`; cũng chạy trực tiếp compiler đã cài | **0** | `tsc.log`, kết quả lệnh trực tiếp |
| `npx tsx scripts/test-streamline-v340-s3.ts` | SWC | **0** | `test-streamline-v340-s3.log` |
| `npx tsx scripts/test-quick-tags-v300.ts` | SWC | **0** | `test-quick-tags-v300.log` |
| `npx tsx scripts/test-streamline-v340-s1.ts` | `npx --no-install tsx scripts/test-streamline-v340-s1.ts` | **0** | `retry-test-streamline-v340-s1.log` |
| `npx tsx scripts/test-streamline-v340-s2.ts` | SWC | **0** | `test-streamline-v340-s2.log` |
| `npx tsx scripts/test-phase5.ts` | SWC | **0** | `test-phase5.log` |
| `npx tsx scripts/test-phase6.ts` | SWC | **0** | `test-phase6.log` |
| `npx tsx scripts/test-phase7.ts` | SWC, workspace TEMP | **0** | `test-phase7.log` |
| `npx tsx scripts/test-phase4-codex-repros.ts` | SWC | **0** | `test-phase4-codex-repros.log` |
| `npx tsx scripts/test-spck-v270.ts` | `npx --no-install tsx scripts/test-spck-v270.ts`, khóa AI giả | **0** | `final-v270.log` |
| `npx tsx scripts/test-spck-v272.ts` | SWC | **0** | `test-spck-v272.log` |
| `npx tsx scripts/test-lms-reliability-v280.ts` | SWC | **0** | `test-lms-reliability-v280.log` |
| `npx tsx scripts/test-session14-v290.ts` | `npx --no-install tsx scripts/test-session14-v290.ts`, khóa AI giả | **0** | `final-v290.log` |
| `npx tsx scripts/test-teaching-project-v320.ts` | `npx --no-install tsx scripts/test-teaching-project-v320.ts` | **0** | `retry-test-teaching-project-v320.log` |
| `npx tsx scripts/test-report-card-v330.ts` | SWC | **0** | `test-report-card-v330.log` |
| Bộ dò S3 độc lập: `node <TEMP>/loader.cjs <TEMP>/adversarial.cjs` | VM chạy hàm component thật + route thật + SQLite giả ở TEMP; AI/LMS được thay bằng phản hồi giả | **1** | `adversarial.log`, `adversarial-results.json`: **12 PASS / 11 FAIL** |

Toàn bộ log trong [s3-round1/](s3-round1/). [gates.json](s3-round1/gates.json), [retry-gates.json](s3-round1/retry-gates.json), [final-gates.json](s3-round1/final-gates.json) giữ mã thoát từng lượt; không dùng mã thoát 0 của chương trình điều phối để thay thế mã thoát từng test.

### Các lượt chẩn đoán thất bại — không che giấu hoặc quy nhầm thành lỗi sản phẩm

| Lượt chạy bổ sung | Exit code thật | Giải thích và xử lý |
|---|---:|---|
| SWC: S1 | **1** | Bản sao TEMP đầu thiếu `AGENTS.md`; đọc tài liệu thất bại `ENOENT`. Bổ sung tài liệu vào bản sao, chạy lại `tsx` từ checkout với dữ liệu TEMP đạt **0**. |
| SWC: v270, v290 | **1, 1** | Khởi tạo runner với khóa Gemini rỗng làm nhánh AI giả không chạy được; không phải lỗi S3. Xác nhận nguyên nhân trong `getGeminiClient()`, chạy lại với khóa giả khác rỗng và mạng bị chặn đạt **0, 0**. |
| SWC: v320 | **1** | Phần dựng giao diện trong TEMP không tìm được React qua bộ phân giải của esbuild. Chạy `tsx` từ checkout, dữ liệu TEMP, đạt **0**. |
| Thử `node <root>/node_modules/tsx/dist/cli.mjs scripts/<suite>.ts` trong bản sao TEMP cho cả 14 suite | **1 cho từng suite** | `NODE_PATH` không giải quyết được các import ESM của bản sao, ví dụ `better-sqlite3`. Đây là 14 lượt chạy không hợp lệ về thiết lập môi trường, không phải 14 lỗi sản phẩm. Chi tiết từng tên/lệnh/code: `tsx-gates.json`, `tsx-test-*.log`. Không tạo junction. |
| `retry-gates.cjs`: v270 và v290 với khóa giả vẫn rỗng | **1, 1** | Chỉ đổi cách chạy chưa giải quyết nguyên nhân khóa AI rỗng. Sau khi dùng `audit-synthetic-offline-key`, hai lệnh `npx` đều đạt **0**. |
| `npx --no-install tsx scripts/test-spck-v270.ts` ở lượt đối chiếu đầu, dữ liệu TEMP | **0** | `tsx-v270.log`; kết quả tốt được chạy lại lần cuối với khóa giả và chặn mạng để không phụ thuộc cấu hình thật. |
| Bộ dò độc lập: lần đầu | **1** | Đường dẫn helper sai: `quick-tags` là thư mục, không phải `quick-tags.ts`. Chỉ sửa harness TEMP. |
| Bộ dò độc lập sau sửa harness; các lần mở rộng | **1 cho mỗi lượt** | Đã chạy đến assertions: lần đầu **7 PASS / 10 FAIL**, thêm race **7 PASS / 11 FAIL**, lần cuối **12 PASS / 11 FAIL**. Kết quả cuối giữ riêng trong JSON. |

Các lệnh đọc tài liệu, tìm kiếm, `git status`, `git diff`, lấy hash và sao chép bản TEMP là thao tác điều tra/chuẩn bị, không phải cổng nghiệm thu. Một vài lệnh tìm kiếm ban đầu sai cú pháp PowerShell/đường dẫn đã được đọc lại đúng; không được tính là gate PASS hay finding ứng dụng.

## 3. Finding Table

Tất cả finding ở trạng thái **OPEN**; kiểm định không tự sửa hoặc đóng lỗi.

| ID | Severity | Status | Vị trí chính xác | Bằng chứng tái hiện | Cách sửa bắt buộc |
|---|---|---|---|---|---|
| **S3-01** | **HIGH** | **OPEN** | `src/app/session-comments/page.tsx:2680`, `:2738`, `:2396`, `:2093` | P03–P06: giữ nhận xét `ORIGINAL TEXT`, gõ `NEW TEXT`, ép lưu nháp trả HTTP 500 rồi bấm nút gộp. Cả luồng cả lớp và từng dòng vẫn gọi `/approve` với **`ORIGINAL TEXT`**, sau đó `/save-lms`; DB giả thành `APPROVED`, giao diện báo thành công/Lỗi 0. Luồng AI vẫn nhận `ORIGINAL NOTE`; duyệt nháp cũng tiếp tục. | Kiểm tra giá trị `false` từ mọi hàm flush và dừng hành động phụ thuộc. Giữ nội dung chưa lưu/khả năng thử lại, không thay lỗi lưu bằng thông báo thành công. Kiểm thử cả lỗi HTTP, lỗi kết nối và `staleIgnored`; xử lý cả lưu vừa hoàn tất do `onBlur` trước khi nút chạy. |
| **S3-02** | **HIGH** | **OPEN** | `src/app/session-comments/page.tsx:2498`, `:2704`, `:2725`, `:2661`; đường nhận `src/lib/playwright/save-comments.ts:118` | P17: hai dòng A/B đều nháp, giữ chậm phản hồi duyệt; sửa A thành `NEW TEXT DURING APPROVAL`, rồi trả phản hồi duyệt. Code nhận ra A đã sửa nhưng chỉ tăng số lỗi. Vì B duyệt được, vẫn gửi `/save-lms` **không giới hạn studentId**, khi SQLite của A còn `APPROVED` với nội dung cũ và hash cũ. Lần tải lại trong hàm save còn kéo A trên màn hình về `ORIGINAL TEXT` trong khi bản mới vẫn ở bộ đệm. | Trước khi đẩy phải xác nhận lại các bản sửa đang chờ và phiên bản từng dòng. Không để hàng bị sửa sau snapshot duyệt tham gia request cả lớp; cách nhỏ nhất là dừng thao tác gộp khi phát hiện sửa đồng thời, giữ bản mới, lưu xong rồi yêu cầu duyệt lại. Không tải lại đè lên các hàng có bản sửa chưa lưu. |
| **S3-03** | **HIGH** | **OPEN** | `src/app/session-comments/page.tsx:1192`, `:1183`, `:1531` | P07/P08: hai học viên có ghi chú đang chờ, gọi handler `beforeunload`, giữ chậm phản hồi đầu. Handler trả ngay; chỉ **S0** phát sinh fetch, **S1** còn trong `debouncedPayloadsRef`; fetch đầu không có `keepalive`. Trình duyệt không đợi chuỗi promise này khi tài liệu bị đóng. | Cần cơ chế gửi toàn bộ phần đang chờ trong sự kiện rời trang mà không phụ thuộc phản hồi dòng đầu, dùng yêu cầu được phép sống qua điều hướng và có giới hạn dung lượng/phương án khi gửi thất bại; hoặc chặn rời trang khi còn bản sửa chưa được xác nhận. Giữ metadata chống lưu cũ. Chỉ gắn event rồi gọi hàm async là chưa đáp ứng S3.1. |
| **S3-04** | **MEDIUM** | **OPEN** | `src/app/api/session-comments/save-draft/route.ts:441`, `:442`, `:514` | P10: items A hợp lệ, B có `teacherNote: {bad:'binding'}`, C hợp lệ. SQLite ném lỗi ở B. API trả HTTP **500** chỉ có `success:false,error`, **A đã được ghi `COMMITTED FIRST`**, C chưa chạy, không có `results`/số lượng. Khác với lỗi validation thông thường được báo từng dòng. | Kiểm tra kiểu từng trường trước ghi và bắt lỗi riêng từng item để trả kết quả đầy đủ cho mọi hàng, bảo toàn thành công đã ghi; hoặc dùng transaction rồi hoàn tác toàn bộ khi chọn chính sách nguyên tử. Không để phản hồi thất bại toàn cục che giấu phần đã ghi. |
| **S3-05** | **MEDIUM** | **OPEN** | `src/app/api/session-comments/approve/route.ts:89`, `:101` | P15 chạy hai trạng thái DB thật trong TEMP: `INSUFFICIENT_INFO` và `FAILED`, đều còn nội dung khác rỗng. Gửi item **không có trường `status`** như chính các bên gọi giao diện. Cả hai trả HTTP **200**, chuyển DB sang `APPROVED`. Guard chỉ nhìn `item.status`, không nhìn trạng thái đã lưu. | Đọc trạng thái hiện tại từ DB và kiểm tra tại thời điểm ghi có điều kiện. Giữ đường retry trực tiếp `/save-lms` cho FAILED còn hash hợp lệ; không cho việc bỏ/giả trường `status` vượt qua điều kiện duyệt. Test phải bỏ trường status, không chỉ tự gửi `status:'FAILED'`. |
| **S3-06** | **LOW** | **OPEN** | `src/lib/zalo/broadcast-generator.ts:166`, `:167` | P16: chỉ trên cấu hình bản TEMP, đổi template `standard_session_broadcast` thành `OWNER_CUSTOM {{className}}`; gọi `generate({classCode:'AUDIT',...})`. Kết quả vẫn bắt đầu `@All Kính gửi...`, dù trả đúng ID template chuẩn. So với baseline: trước đây luôn gọi `renderZaloBroadcast(template.id, variables)` nên mẫu đã lưu được áp dụng. | Dùng bộ engine chung để chuẩn bị dữ kiện/biến, nhưng giữ việc áp dụng mẫu người dùng đã lưu, kể cả ID chuẩn; hoặc có thay đổi sản phẩm được Owner duyệt rõ ràng. Thêm kiểm tra tùy chỉnh chính ID chuẩn, không chỉ template phụ. |

### Giải thích giới hạn và xuất xứ của finding

- S3-01/S3-02: probe chạy component trong VM, route duyệt/lưu nháp thật và SQLite giả. AI và kết quả ghi LMS được mô phỏng để giữ an toàn. Đã chứng minh **request sai được phát ra và nội dung cũ được duyệt trong DB giả**, chưa tuyên bố đã ghi sai lên LMS thật. Mã `CommentSaver` hiện chọn toàn bộ bản APPROVED khi thiếu studentId nên có đường đi cụ thể cho S3-02; hash cũ vẫn hợp lệ đối với DB cũ và không giải quyết được bản mới còn nằm ở trình duyệt.
- S3-03: bằng chứng là thứ tự dispatch của handler thật và tùy chọn fetch, chưa thực hiện đóng trình duyệt thật để đo mất dữ liệu. Đây là lỗi thiết kế flush khi rời trang, không phải bằng chứng dữ liệu Owner đã mất.
- S3-04 là giới hạn mới của xử lý batch khi có ngoại lệ trong item, không yêu cầu rollback cả batch đối với mọi lỗi validation. P09 đã chứng minh đường **lỗi validation từng phần thông thường** giữ hàng thành công và hoàn nguyên đúng hàng thất bại.
- S3-05: baseline cũng không kiểm tra trạng thái DB tại bước này. Đây là **thiếu sót kế thừa chưa được chặn bởi guard S3 mới**, không quy là hồi quy do S3 gây ra. Vẫn cần giải quyết vì prompt S3 yêu cầu validation với INSUFFICIENT_INFO/FAILED. Nhận xét cũ có thể được giữ lại khi AI trả thiếu dữ kiện, nên trường hợp trạng thái và nội dung còn cùng tồn tại không phải dữ liệu bất khả thi.
- S3-06: đã tìm toàn bộ `src` và `scripts`. Hiện không thấy caller ứng dụng khác dùng `ZaloBroadcastGenerator.generate` ngoài kiểm thử; màn hình session-comments gọi engine trực tiếp. Vì vậy đây là hồi quy hợp đồng của module/mẫu cấu hình, xếp **LOW**, không nói rằng mọi thao tác gửi Zalo hiện tại của giáo viên đều đang hỏng.

## 4. Bộ dò độc lập và các kiểm tra đạt

Nguồn: [adversarial.cjs](s3-round1/adversarial.cjs). Kết quả: [adversarial-results.json](s3-round1/adversarial-results.json). Harness được viết mới trong TEMP, không sửa file `src/**` hay `scripts/**`; hàm component được nạp vào bộ nhớ trước phần JSX. Hàm route và cơ chế ghi SQLite dùng đúng mã đang kiểm định. Mỗi case có class/student/session giả riêng.

| Kiểm tra | Kết quả | Ý nghĩa |
|---|---|---|
| P01/P02 | PASS/PASS | Gõ liên tiếp không gửi sớm; flush tương ứng blur lưu đúng chữ cuối. |
| P03/P04/P05/P06 | FAIL × 4 | Lỗi lưu không chặn AI, duyệt cả lớp, duyệt từng dòng và duyệt nháp — S3-01. |
| P07/P08 | FAIL × 2 | Đóng trang không dispatch hết dòng và thiếu keepalive — S3-03. |
| P09 | PASS | Batch validation lỗi một hàng: hàng thành công PRESENT, hàng thất bại trở lại UNKNOWN; thông báo 1/2. |
| P10 | FAIL | Ngoại lệ item che giấu phần đã ghi — S3-04. |
| P11/P12 | PASS/PASS | Chặn field version cũ và trả HTTP 409 khi row version duyệt đã cũ. |
| P13/P14 | PASS/PASS | Hash duyệt đúng SHA-256 của văn bản; sửa nội dung hạ về DRAFT và bỏ hash duyệt. |
| P15 (hai case) | FAIL × 2 | Bỏ trường status vượt guard trạng thái DB — S3-05. |
| P16 | FAIL | Mẫu chuẩn đã tùy chỉnh bị bỏ qua — S3-06. |
| P17 | FAIL | Sửa trong khi duyệt vẫn dẫn tới request cả lớp chọn bản APPROVED cũ — S3-02. |
| P18/P19/P20 | PASS × 3 | Trong đường lưu thành công, AI/từng dòng/cả lớp dùng đúng nội dung mới sau flush. |
| P21 | PASS | Hai yêu cầu lưu đến ngược thứ tự vẫn giữ nội dung mới. |
| P22 | PASS | Xác nhận UNKNOWN thành PRESENT giữ nguyên học viên ABSENT. |

Bảy file S3 ban đầu và toàn bộ mã/test được bảo toàn sau các lượt này; fingerprint nguồn mới cho phép lượt sửa sau kiểm định lại đúng phiên bản, không dùng kết quả này cho cây mã khác.

## 5. Đối chiếu các quy tắc an toàn của dự án

- **Chạy nội bộ:** script dev/start vẫn bind `127.0.0.1`; các route S3 vẫn đi qua `validateLocalRequest`. Ngoại lệ Student Portal trong tài liệu và nguồn có kích hoạt phiên, `sessionToken` và bind `0.0.0.0`; không mở portal/tunnel trong lượt này.
- **Ranh giới client/server:** `zalo-summary.ts` không import filesystem, DB, cấu hình bí mật hoặc môi trường server. Import từ quick-tags dùng kiểu dữ liệu cấu hình, không đưa module đọc file về trình duyệt. Chưa phát hiện đường lộ secret mới do các import S3.
- **Path Allowlist:** cấu hình đọc qua `json-config` và `assertPathAllowed`; mọi suite/probe được khởi động với ba biến đường dẫn TEMP. Một số suite tự tạo tiếp thư mục thử ở TEMP hoặc mở rộng allowlist để đọc fixture/mã dự án; không đổi đường DB/cache sang dữ liệu Owner.
- **Trình duyệt:** route save-lms vẫn qua `SequentialTaskQueue`, `CommentSaver` giữ xác minh phản hồi và đọc lại; S3 không đổi bộ quản lý Persistent Context. Chromium trong test là browser giả lập riêng, không dùng `playwright-auth` Owner để đăng nhập. Không dùng công cụ gửi stdin bị cấm.
- **Checkpoint:** nguồn vẫn chỉ xử lý ô nhận xét chung; giữ nhắc giáo viên tích điểm năng lực với trạng thái APPROVED và các mốc Coding 5/9, Robotics 4/8 qua helper dùng chung. Các gate hồi quy kiểm tra luồng này bằng fixture; chưa nghiệm thu thao tác thật trên LMS.
- **Toàn vẹn:** khóa lớp/buổi/học viên và hash SHA-256 vẫn hoạt động trong các control P11–P14; các lỗi S3-01/S3-02 phát sinh trước khi bản mới được xác nhận vào DB nên không được hash cũ ngăn chặn.
- **AI/Zalo:** không gọi Gemini thật. Suite S3 kiểm tra sáu phần, ngày kế tiếp, không tự thêm Phần 2 nếu thiếu dữ kiện ảnh; các bộ hồi quy kiểm tra guardrails/ẩn danh với dữ liệu giả. Không chứng nhận toàn bộ đường xử lý ảnh gửi AI ngoài phần import mới của S3, hay mọi tình huống ẩn danh/dịch vụ thật. Quy tắc logo SPCK không bị S3 thay đổi và được kiểm qua hồi quy SPCK.

## 6. Production Data Preservation Check

Chỉ dùng ngoại lệ đọc hash được Owner cho phép:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath 'data/mindx_bot.db', 'data/running_classes.json'
```

Không mở kết nối SQLite, sao chép, chỉnh sửa hay xóa hai file thật này.

| File | SHA-256 trước | SHA-256 sau | Đối chiếu kỳ vọng |
|---|---|---|---|
| `data/mindx_bot.db` | `28574C5708D04162B18D65746EC8788C456274E206542255206CE5084E446ED7` | `28574C5708D04162B18D65746EC8788C456274E206542255206CE5084E446ED7` | **UNCHANGED — MATCH** |
| `data/running_classes.json` | `ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2` | `ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2` | **UNCHANGED — MATCH** |

Ngoài hai hash trên, đối chiếu **2.219/2.219 file được bảo vệ** trước/sau: không file đổi hoặc mất. Bao gồm `src/**`, `scripts/**`, `data/config/**`, `next-env.d.ts`, hồ sơ audit đã có (kể cả round-12..round-41) và ba tài liệu trạng thái. Phase 7 chạy trong workspace TEMP, cấu hình thật không bị dùng làm nơi ghi thử. Bằng chứng: [preservation.json](s3-round1/preservation.json), [production-hashes.json](s3-round1/production-hashes.json).

Không gửi request nghiệp vụ tới `lms.mindx.edu.vn` hoặc `teachingmindx.top`. Suite dùng route/transport giả; các lượt `tsx` đối chiếu bổ sung chặn kết nối ngoài trong Node và dùng proxy loopback không hoạt động cho browser để request chưa được mock không thoát ra ngoài. Không có thao tác gửi tin Zalo, ghi dữ liệu dịch vụ thật hoặc đổi tài khoản/khóa thật.

TEMP được dọn sau khi lưu bằng chứng bằng Node `fs.rmSync(..., { recursive: true, force: true })`, không tạo junction `node_modules` và không dùng PowerShell xóa đệ quy. Trạng thái dọn được lưu tại [cleanup.json](s3-round1/cleanup.json).

## 7. Điều kiện kiểm định vòng tiếp theo

1. Sửa S3-01/S3-02/S3-03 trước: ngăn duyệt/đẩy khi lưu chưa xác nhận, không đẩy bản cũ của hàng đang sửa, và bảo vệ toàn bộ bản chờ khi rời trang.
2. Sửa báo cáo ngoại lệ batch và guard trạng thái DB; giải quyết rõ tương thích mẫu Zalo chuẩn.
3. Chạy lại 15 gate, bộ dò độc lập với assertions giữ nguyên, bổ sung trình duyệt thật nhưng dữ liệu/mạng vẫn giả cho rời trang và gõ trong lúc duyệt. Không chỉ thêm kiểm tra chuỗi có `flush`/`beforeunload` trong mã.
4. Chốt hash nguồn mới, đối chiếu lại dữ liệu thật chỉ bằng hash. Chỉ đề nghị GO khi không còn finding cần sửa và có bằng chứng mới tương ứng; không thay thế kết quả kiểm định cục bộ bằng nghiệm thu LMS thật.

**Kết luận: NO-GO cho S3 Round 1. Chưa sửa sản phẩm; Owner không cần thực hiện thao tác kỹ thuật để hoàn tất lượt kiểm định này.**
