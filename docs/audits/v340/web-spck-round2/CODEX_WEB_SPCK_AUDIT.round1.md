# Kiểm định độc lập Web SPCK và tinh gọn `/final-project` — v3.4.0

Ngày kiểm định: **03/11/2026** (Asia/Saigon). Vai trò: Independent Quality & Safety Auditor.

## Decision / Verdict

**NO-GO** cho đợt nâng cấp giới hạn 10 ảnh / 10 file Web SPCK đang được kiểm định.

Năm cổng kiểm tra có sẵn đều đạt, nhưng probe độc lập đạt **13/19 ca**, còn **6 ca lỗi**, quy về **4 phát hiện mở: 2 HIGH, 1 MEDIUM, 1 LOW**. Có trường hợp bỏ sót mã nguồn hợp lệ và hiển thị danh sách tệp khác với bản đã duyệt. Chưa đủ điều kiện nghiệm thu đợt nâng cấp này.

Kết luận chỉ áp dụng cho bản làm việc hiện tại, gồm các thay đổi chưa lưu thành commit, trên nền HEAD `9ed1d2b4d44fb31e4c1ed6730cc9244fb234b70a`. Nhánh `main` đang đi trước `origin/main` 11 commit tại thời điểm bắt đầu; không cập nhật từ xa trong cuộc kiểm định này. Kết quả GO của S8 Round 4 ngày 30/10 là bằng chứng lịch sử, không thay thế kiểm định bản Web SPCK ngày 03/11.

**Mã ứng dụng, bộ kiểm thử gốc và cấu hình gốc không bị sửa. Hai tệp dữ liệu thật khớp SHA-256 trước/sau và khớp giá trị Owner cung cấp.**

## Phạm vi và phương pháp

Đã đọc `PROJECT_STATE.md` trước, đối chiếu `MINDX_AUTOMATION_PLAN.md`, `CHANGELOG.md`, `AGENTS.md`, tám tệp mã trong yêu cầu và các phần liên quan: lưu nháp theo buổi trong `sqlite.ts`, bộ dựng dữ liệu `/api/spck/list`, kiểm tra đường dẫn và xác thực tệp đính kèm.

- TypeScript chạy trực tiếp tại thư mục dự án với `--incremental false`, không sinh tệp biên dịch.
- Bốn suite chạy trên bản sao trong `%TEMP%\mindx-web-spck-audit-20261103-codex\snapshot`. Toàn bộ `src/**` và `scripts/**` của bản sao đã được so sánh SHA-256 với bản gốc: **không có sai khác**.
- Chỉ sao chép cấu hình phục vụ kiểm thử; không sao chép `.env`, `.env.local`, cơ sở dữ liệu thật hoặc hồ sơ đăng nhập trình duyệt. Danh sách đường dẫn giáo viên từng chọn trong bản sao được thay bằng danh sách rỗng. `node_modules` dùng liên kết thư mục đến các thư viện đã cài; không cài hay cập nhật thư viện.
- Mọi lệnh chạy kiểm thử đều đặt bốn biến cô lập theo yêu cầu. Dữ liệu giả, ZIP thử, ảnh thử, cấu hình phát sinh và bản lưu tạm đều nằm trong TEMP.
- Không truy cập hoặc ghi vào `F:\MINDX_SPCK_FINAL\JSB16`; cấu trúc tương tự được tạo từ dữ liệu giả.
- Probe gọi trực tiếp route thật bằng `Request` cục bộ; không dùng dev server đang chạy. Phần giao diện gọi đúng hàm `handleScanFolder` trích từ mã hiện tại trong môi trường giả lập, không viết lại thuật toán đó.
- Checkout này **không có hàm `collectStudentWebFiles`**. Luồng thật dùng hàm nội bộ `copyWebDirectoryRecursive`. Probe xuất tạm hàm này trong bộ nhớ để kiểm tra đúng thao tác dựng thư mục chuẩn bị đưa lên GitHub, cùng `ensureRootIndexHtmlEntry`. Không thay đổi tệp mã ứng dụng và không đẩy GitHub thật.

## Gate Execution Summary

| Lệnh | Nơi chạy | Kết quả | Bằng chứng |
|---|---|---|---|
| `npx --no-install tsc --noEmit --incremental false` | Dự án gốc | **PASS**, exit 0 | `tsc.log`, không có lỗi TypeScript |
| `npx --no-install tsx scripts/test-phase6.ts` | Bản sao TEMP | **PASS**, exit 0; 9,98 giây | Đủ nhóm TASK-6.1 đến TASK-6.5 |
| `npx --no-install tsx scripts/test-spck-v270.ts` | Bản sao TEMP | **PASS**, exit 0; 8,12 giây | Đủ T01–T16, gồm T12 |
| `npx --no-install tsx scripts/test-spck-v272.ts` | Bản sao TEMP | **PASS**, exit 0; 22,51 giây | Suite hoàn tất, gồm ảnh Owner và chụp Web offline |
| `npx --no-install tsx scripts/test-streamline-v340-s5.ts` | Bản sao TEMP | **PASS**, exit 0; 7,45 giây | S5b-T1–T4, có kiểm tra giao diện bằng trình duyệt với API giả lập |
| `npx --no-install tsx audit-probe.cts` | Bản sao TEMP | **FAIL**, exit 1; **13 PASS / 6 FAIL** | `probe-results.json`, `probe.log` |

`--no-install` bảo đảm dùng công cụ đã cài, không tải/cài mới. Lần chạy phase6 đầu trong môi trường hạn chế quyền bị `spawn EPERM` khi mở tiến trình biên dịch. Đã chạy lại thành công bằng quyền thực thi phù hợp với cùng bốn biến cô lập. Không tính lỗi môi trường ban đầu là lỗi sản phẩm.

Hai lượt chuẩn bị probe ban đầu cần sửa chính bộ thử: dùng SWC có sẵn thay API TypeScript không hiện diện trong bản cài này; truyền đầy đủ bản ghi cũ khi dựng fixture cho `upsert`. Đây không phải thay đổi mã ứng dụng. Bảng dưới là kết quả lượt cuối với fixture được khởi tạo sạch.

### Probe độc lập

| Ca | Nội dung kiểm chứng | Kết quả thực tế |
|---|---|---|
| P01 | 24 ảnh trong `images/`, ảnh tại `img/`, `Articles/`, `LCourses/`, `printer accessories/`, icon gốc; 23 tệp nguồn hợp lệ trong thư mục con; HTML 0 byte/không nội dung và JS có null | **PASS**: `screenshots=[]`; một ZIP hợp lệ với đúng 23 tệp nguồn; không chứa ảnh nguyên liệu hoặc tệp rỗng/null |
| P02 | Quét lại lần hai | **PASS**: vẫn một ZIP; danh sách và số lượng tệp trong ZIP không đổi; không lồng ZIP |
| P03 | Điểm vào HTML sâu 2 và 3 cấp; dựng thư mục chuẩn bị GitHub | **PASS**: tìm đúng `HTML/main/index.html` và `html/main/site/index.html`; không sao chép ba thư mục `_spck_*` hay ZIP; giữ `.jfif`, `.text`; tạo trang chuyển hướng đúng |
| P04 | Một học viên có 13 ảnh Owner, một học viên hợp lệ | **PASS**: HTTP 200, `success:true`, có `warning`; có bản ghi học viên hợp lệ; không lưu bài quá giới hạn |
| P05 | Tất cả thư mục được quét đều quá giới hạn | **PASS**: HTTP 400, `success:false` |
| P06 | Nháp DRAFT trống của cả buổi 12/13/14 | **PASS**: đồng bộ tài nguyên mới ngay, giữ nhận xét rỗng và trạng thái DRAFT |
| P07 | Có nhận xét, lần lượt WAITING_APPROVAL / APPROVED / VERIFIED | **PASS**: toàn bộ bản ghi nháp theo buổi giữ nguyên sau quét lại |
| P08 | Danh sách ảnh cũ gồm ảnh nguyên liệu và ảnh chụp `_spck_app_shots` | **PASS**: loại ảnh nguyên liệu khỏi kho dùng chung, giữ ảnh chụp |
| P09 | 12 tệp `.htm` hợp lệ ngay tại gốc | **FAIL**: không có ZIP, không có tệp đính kèm — F01 |
| P10 | `index.html` và 12 tệp `.mjs` hợp lệ ngay tại gốc | **FAIL**: chỉ đính kèm `index.html`, không có ZIP — F01 |
| P11 | `index.html` tham chiếu `modules/app.mjs` | **FAIL**: bỏ sót module trong thư mục con, không tạo ZIP — F01 |
| P12 | `large.js` hợp lệ 5.242.884 byte, cùng `index.html` và `CSS/style.css` | **FAIL**: tệp lớn bị bỏ khỏi ZIP và danh sách đính kèm — F02 |
| P13 | HTML gốc chỉ chứa khoảng trắng, cạnh một HTML có nội dung | **FAIL**: HTML trắng vẫn được đưa vào tệp đính kèm — F04 |
| P14 | Quét lại khi buổi 13 APPROVED có danh sách tệp cũ và đã xuất hiện tệp mới | **FAIL**: giao diện hiện cả tệp mới dù bản ghi trả về vẫn giữ bộ tệp đã duyệt — F03 |
| P15 | Tệp JS có byte null trong dự án được đóng ZIP | **PASS**: không nằm trong ZIP |
| P16 | Chụp HTML offline với 24 PNG màu khó nén, tổng **16.604.112 byte** | **PASS**: sinh ảnh thật qua bộ chụp offline, kích thước 960×540; không chỉ có ảnh phục dựng; không gặp ENOBUFS trong fixture này |
| P17 | 13 tệp `.html`/`.js` hợp lệ ngay tại gốc | **PASS**: gom đủ 13 tệp vào một ZIP hợp lệ |
| P18 | DRAFT đã có nhận xét hoặc ghi chú giáo viên | **PASS**: giữ nguyên toàn bộ hai bản ghi khi quét lại |
| P19 | DRAFT trống nhưng còn `lastVerifiedAt` của lịch sử nộp | **PASS**: không đồng bộ đè bản ghi |

## Finding Table

| ID | Mức độ | Vị trí | Phát hiện và tác động | Bằng chứng tối thiểu |
|---|---|---|---|---|
| **F01** | **HIGH** | `src/lib/local-files/spck-scanner.ts:32`, `:1075`, `:1327` | Điều kiện đóng gói đếm `validAttachments`, trong khi danh sách này không nhận đủ các đuôi đã được `WEB_SOURCE_BUNDLE_EXTS` công nhận. Cờ thư mục con chỉ xét HTML/CSS/JS, bỏ `.mjs` và các nguồn Web khác. Dự án hợp lệ có thể nộp thiếu phần lớn mã hoặc không có mã đính kèm. | P09: 12 `.htm` → `allAttachments=[]`. P10: HTML + 12 `.mjs` → chỉ HTML. P11: `modules/app.mjs` → không ZIP. |
| **F02** | **HIGH** | `src/lib/local-files/spck-scanner.ts:1078`, `:1345` | Bộ gom bỏ tệp nguồn trên 5 MB nhưng bước thay danh sách đính kèm lại loại mọi tệp cùng đuôi, kể cả tệp chưa được đưa vào ZIP. Vì vậy một tệp đã vượt qua `validateSpckAttachmentFile` bị mất khỏi gói chuẩn bị nộp mà không có cảnh báo tương ứng. File gốc trên ổ vẫn còn. | P12: `validateSpckAttachmentFile(large.js).valid=true`; ZIP chỉ chứa `CSS/style.css`, `index.html`; danh sách đính kèm chỉ chứa ZIP. |
| **F03** | **MEDIUM** | `src/app/final-project/page.tsx:1449` | Khi dựng dòng sau quét, ảnh/nhận xét/trạng thái lấy từ bản ghi theo buổi, nhưng tệp đính kèm luôn lấy `pkg.attachments` mới. Giáo viên nhìn một bộ tệp khác với bộ đã duyệt; lần lưu tiếp theo có thể đưa bộ mới vào nháp dù chưa bấm dùng tài nguyên mới nhất. | P14: bản ghi APPROVED có `[index.html,new.js]`; UI hiện `[additional.js,index.html,new.js]`, vẫn mang trạng thái APPROVED và `hasNewerSharedResources=true`. Dữ liệu lưu theo buổi không bị ghi đè bởi chính lần quét. |
| **F04** | **LOW** | `src/lib/local-files/spck-scanner.ts:527`, `:1285` | Nhánh đính kèm thông thường chỉ loại 0 byte, không loại HTML toàn khoảng trắng. Dự án chưa cần đóng ZIP vẫn nhận tệp không có nội dung, chiếm ô đính kèm. | P13: `empty.html` có nội dung `" \n\t"` vẫn nằm trong `allAttachments`. Nhánh gom ZIP của P01 đã loại đúng tệp tương tự. |

### Hướng sửa tối thiểu để kiểm định lại

1. **F01:** Dùng tập tệp Web hợp lệ đã thu thập để quyết định vượt 10 tệp; phát hiện mã trong thư mục con trên cùng tập phần mở rộng đó. Bảo đảm `.htm`, `.mjs`, `.text` và các đuôi được yêu cầu có đường đưa vào gói nộp. Giữ giới hạn LMS và cơ chế không lồng ZIP.
2. **F02:** Chỉ bỏ tệp rời khỏi danh sách khi chính tệp đó đã có trong ZIP được xác thực. Với tệp không đóng gói được, giữ lại nếu hợp lệ hoặc báo lỗi rõ ràng; không âm thầm loại.
3. **F03:** Dựng `attachments` từ bản ghi theo buổi khi có bản ghi; dùng gói quét làm giá trị dự phòng khi chưa có. DRAFT nguyên bản tiếp tục nhận tài nguyên mới qua bước đồng bộ ở route; bản đã chỉnh sửa/duyệt giữ bộ tệp của mình.
4. **F04:** Kiểm tra nội dung HTML văn bản trước khi nhận làm đính kèm, thống nhất giữa nhánh rời và nhánh ZIP.

Các hướng trên là đề xuất sửa, **chưa triển khai** trong cuộc kiểm định này.

## Những phần đã đạt trong phạm vi bằng chứng

- Phân biệt ảnh Web trong các thư mục tài nguyên với ảnh quản lý bởi SPCK: đạt trên fixture nhiều thư mục và nhiều ảnh.
- Đóng gói mã HTML/CSS/JS chia thư mục con, không lồng ZIP khi quét lại: đạt trên P01/P02. Đóng gói mã HTML/JS gốc quá 10 tệp: đạt trên P17.
- Bộ dựng thư mục GitHub giữ `.jfif`/`.text`, loại thư mục ảnh quản lý SPCK và ZIP: đạt P03. ZIP không được phép qua danh sách đuôi của bộ triển khai; không có nhánh loại tên ZIP riêng, nhưng hiệu quả loại ZIP hiện tại đã được thực thi và kiểm chứng.
- Bộ chụp dùng `timeout:30000`, `maxBuffer:64*1024*1024` tại `spck-app-screenshotter.ts:1160`; P16 xác nhận chụp offline với đầu vào ảnh hơn 16 MB. Kết quả này không bảo đảm cho mọi kích thước hoặc mọi trang Web.
- `/api/spck/scan` trả 200 cho lớp có một bài hợp lệ dù bài khác quá giới hạn; chỉ trả 400 theo điều kiện lỗi giới hạn khi không lưu được bài hợp lệ: đạt P04/P05 và T12 cũ.
- Đồng bộ các DRAFT nguyên bản; giữ bản đã nhận xét/ghi chú hoặc có lịch sử xác nhận: đạt P06/P07/P18/P19. Không phát hiện route tự ghi đè các bản nháp được bảo vệ trong các ca này.
- Đã đối chiếu mã nhận diện `_web_package.zip` tại `useSpckWorkflow.ts:3349`, `:3362`, `:3667`, `:3672`.
- Đã đối chiếu điều kiện `!autoRunToolsAfterScan` ở hai nút ngoài của `ToolsDrawer.tsx:147`, `:166` và nút chạy lại trong ngăn công cụ tại `:493`, `:510`. `Session14Panel.tsx` không còn nút “Đã Mở Tab 2” và dãy thống kê lặp; giữ ngăn sửa/thử lại. Đây là đối chiếu mã kết hợp suite giao diện giả lập S5, chưa phải nghiệm thu giao diện với lớp thật.
- Tài liệu có mô tả bản nâng cấp và quy tắc an toàn; `AGENTS.md` đã được đọc và giữ nguyên. Ba tài liệu quản lý được bổ sung ghi chú NO-GO của cuộc kiểm định này theo quy tắc dự án.

## Production Data Preservation Check

Đo bằng Node.js **chỉ đọc**: `crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').toUpperCase()`. Không mở dữ liệu thật qua bộ lưu trữ ứng dụng và không dùng `Get-FileHash` trên cơ sở dữ liệu đang được sử dụng.

| Tệp thật | SHA-256 trước | SHA-256 sau | Kết quả |
|---|---|---|---|
| `data/mindx_bot.db` | `1483E2B9079B4A9D2E436AC4312907FED450F9A46F508930B1B785F332831802` | `1483E2B9079B4A9D2E436AC4312907FED450F9A46F508930B1B785F332831802` | **UNCHANGED**, khớp Owner |
| `data/running_classes.json` | `F03A852729D2D75470991BD4B8BAE2D86AB0EE0A68ABBF7801FB7417C125CBE9` | `F03A852729D2D75470991BD4B8BAE2D86AB0EE0A68ABBF7801FB7417C125CBE9` | **UNCHANGED**, khớp Owner |

Trước bước ghi báo cáo, **2.221/2.221 tệp có trong danh mục ban đầu giữ nguyên nội dung**, không thiếu tệp. Sau bước ghi tài liệu, chỉ cho phép sai khác tại `PROJECT_STATE.md`, `CHANGELOG.md`, `MINDX_AUTOMATION_PLAN.md` và báo cáo mới này; phần cuối được đối chiếu lại riêng. Mọi thay đổi chưa commit của Owner từ trước kiểm định được giữ nguyên. Không reset Git, không commit, không khởi động lại dev server.

Lưu ý ranh giới bằng chứng: SHA-256 xác nhận hai tệp được yêu cầu không đổi; đây không phải phép so sánh toàn bộ trạng thái máy chủ đang chạy hoặc mọi tệp phụ SQLite ngoài danh mục đã đo.

## Bằng chứng và cách chạy lại

Thư mục bằng chứng cục bộ:

```text
C:\Users\QQ\AppData\Local\Temp\mindx-web-spck-audit-20261103-codex\
  baseline.json
  status-before.txt
  gates.json
  tsc.log
  test-phase6.log
  test-spck-v270.log
  test-spck-v272.log
  test-streamline-v340-s5.log
  probe.log
  probe-results.json
  preservation-before-report.json
  preservation-final.json
  source-fingerprints.json
  PROJECT_STATE.md.pre-audit
  CHANGELOG.md.pre-audit
  MINDX_AUTOMATION_PLAN.md.pre-audit
  snapshot\audit-probe.cts
```

Tệp probe và fixture được giữ tại TEMP để tái hiện; chưa dọn bằng chứng. Bộ thử tự khởi tạo lại các bản ghi có mã lớp giả cố định `TEST_AUDIT_WEB_SPCK` trên cơ sở dữ liệu TEMP. Không chạy lại probe trên cơ sở dữ liệu thật.

Lệnh dùng trong PowerShell, tại bản sao TEMP nêu trên:

```powershell
$env:ALLOWED_LOCAL_DIRS = $env:TEMP
$env:MINDX_DB_PATH = "$env:TEMP\mindx_codex_web_spck.db"
$env:MINDX_RUNNING_CLASSES_PATH = "$env:TEMP\mindx_codex_web_spck_rc.json"
$env:GEMINI_API_KEY = "test-web-spck-dummy-key"
$env:AUDIT_TEMP = Join-Path $PWD 'temp_submissions\independent-web-probe'
node -e "const p=require('node:path'),t=p.resolve(process.env.AUDIT_TEMP),r=p.resolve(process.env.TEMP);if(!t.toLowerCase().startsWith(r.toLowerCase()+p.sep)||p.basename(t)!=='independent-web-probe')throw Error('unsafe target');require('node:fs').rmSync(process.env.AUDIT_TEMP, { recursive: true, force: true })"
npx --no-install tsx audit-probe.cts
```

### Chưa kiểm tra

Không nộp LMS thật, không đẩy GitHub Pages/Drive thật, không gọi Gemini với khóa thật; không kiểm tra lớp JSB16 của Owner, không build production mới và không nghiệm thu trực quan toàn bộ luồng trên tài khoản thật. Không suy rộng các suite cục bộ sang kết luận dịch vụ thật đã hoạt động.

### Việc tiếp theo

Giao sửa F01–F04 trong một nhiệm vụ riêng, sau đó chạy lại 5 cổng và 19 ca probe trên đúng bản mã đã sửa. Chỉ chuyển GO khi các lỗi còn mở được đóng bằng bằng chứng; bước thử với lớp thật là một bước nghiệm thu riêng sau đó.
