# Final Acceptance Closure Audit — v3.4.0 — S8 Round 2

**VERDICT: NO-GO** cho đóng S8/nghiệm thu tổng thể v3.4.0.

**S8-01: CLOSED. S8-02: CLOSED.** Hai phát hiện MEDIUM của Round 1 đã được xử lý đúng phạm vi gốc. Tuy nhiên, bản thay thế bộ dựng HTML phát sinh **S8-R2-01 — HIGH OPEN**: đọc ảnh ngoài Path Allowlist. Không thể chuyển trạng thái thành GO khi ranh giới đọc tệp mới còn bị vượt qua.

Ngày: **30/10/2026**, Asia/Saigon. Kiểm định trực tiếp theo vai trò Independent Auditor do Owner yêu cầu `gpt-6.1-sol high`; không có phép đo runtime riêng xác nhận tên model hoặc mức suy luận. Không gọi reviewer khác hoặc gán kết quả cho model không được chạy. Không sửa mã sản phẩm/test sản phẩm, không commit/push, không gọi dịch vụ thật.

## 1. Mốc mã, phạm vi và cô lập

- HEAD: `faf9fbc775b56bed79c766720589783b08fcee5c`, cộng các thay đổi có sẵn trong cây làm việc. [Trạng thái đầu](s8-round2/git-status-before.txt).
- Đối chiếu toàn bộ **2.003 tệp** trong [snapshot Round 1](s8-final/protected-before.json): chỉ **bốn tệp nguồn** bên dưới khác hash; **1.999 tệp còn lại giữ nguyên**, không có nguồn/test mới. Kết quả: [round1-comparison.json](s8-round2/round1-comparison.json).
  - `src/app/api/spck/browse-folder/route.ts`
  - `src/app/api/spck/capture-screenshots/route.ts`
  - `src/lib/local-files/spck-image-normalizer.ts`
  - `src/lib/local-files/spck-app-screenshotter.ts`
- Bản sao chạy kiểm thử: `C:\Users\QQ\AppData\Local\Temp\mindx-s8-r2-mqvql56m`. Mã `src/` khớp workspace trước và sau chạy.
- Không chép `.env`, DB/cache vận hành, danh sách thư mục giáo viên đã chọn hoặc `playwright-auth`. Chỉ chép nguồn/test và cấu hình cần thiết; dùng thư viện cài sẵn qua junction.
- Các tiến trình chạy với bốn biến cô lập bắt buộc bên dưới; thêm `QT_QPA_PLATFORM=offscreen`, chặn kết nối mạng ngoài trong Node. Chromium của bài kiểm thử S5 chỉ phục vụ giao diện giả cục bộ; không dùng hồ sơ đăng nhập Owner. Các ca PyQt6 dùng HTML/ảnh giả offline, không đặt URL mạng bên ngoài.

```powershell
$env:ALLOWED_LOCAL_DIRS = $env:TEMP
$env:MINDX_DB_PATH = "$env:TEMP\mindx_codex_s8_r2.db"
$env:MINDX_RUNNING_CLASSES_PATH = "$env:TEMP\mindx_codex_s8_r2_rc.json"
$env:GEMINI_API_KEY = "test-s8-dummy-key"
```

Các suite có cấu hình giả nội bộ như mã gốc. Riêng probe đường dẫn thu hẹp vùng cho phép về thư mục giả để tạo đối chứng bị cấm; probe mở rộng cuối còn cho phép **đúng tệp DB TEMP** để kiểm tra hàng đợi, không mở toàn bộ TEMP trong đối chứng đó. Không có truy cập DB thật. Chi tiết: [isolation.json](s8-round2/isolation.json), [runner](s8-round2/run-audit.py), [probe bổ sung](s8-round2/edge-probe.cjs).

## 2. S8-01 — CLOSED

**Nguyên nhân cũ:** Nhánh `action: list` nhận đường dẫn rồi liệt kê thư mục ngoài phạm vi được phép.

**Kiểm tra mã:** `resolveStartDirectory` chặn đầu vào bằng `assertPathAllowed`, kiểm đường dẫn thực sau `realpathSync`; `listSubdirectories` kiểm thư mục cha và đường dẫn thực từng thư mục con. `parentPath`, `drives`, `quickLinks` chỉ trả đường dẫn thỏa allowlist. `isPathAllowed` hiện có tự chuẩn hóa junction/symlink, nên kiểm tra metadata cũng xét đích thật. Nhánh `list` không gọi đăng ký thư mục giáo viên.

**Bằng chứng chạy mới:** [probe gốc](s8-round2/path-probe.json) trả **403**, `policyPass: true`, `directoryUnregistered: true`. Probe gốc nguyên mã được chạy trong mirror với `AUDIT_PATH_OUT`, không ghi đè bằng chứng Round 1.

**11 ca bổ sung đạt:** `path` ngoài vùng; `initialDir` ngoài vùng; `..` thoát vùng; truy cập junction trực tiếp; đường dẫn ngoài vùng chưa tồn tại; không liệt kê/đăng ký thư mục bị cấm; đường dẫn hợp lệ trả 200 và lọc junction thoát vùng; junction nội bộ được giữ; metadata/parent hợp lệ; khởi đầu mặc định hợp lệ; cấu hình thư mục không tồn tại vẫn fallback an toàn. Một số điều kiện được gộp trong cùng ca. Spy `readdirSync` xác nhận không liệt kê thư mục giả bị cấm; registry trong mirror giữ nguyên. [20 ca tổng hợp](s8-round2/edge-results.json).

**Kết luận:** Đóng S8-01 trong phạm vi nhánh duyệt thư mục; không đồng nghĩa mọi bộ đọc tệp khác đều an toàn.

## 3. S8-02 — CLOSED theo phát hiện gốc về BrowserContext/hàng đợi

**Kiểm tra mã và chạy mới:**

- [Probe gốc](s8-round2/browser-policy-probe.json): `standaloneLaunches === 0`, `newContexts === 0`, `strictSinglePersistentContextPolicyPass === true`. Đầu vào gốc là buffer giả, nên probe này tự nó không chứng minh giải mã ảnh; đã bổ sung kiểm tra ảnh thật được tạo trong TEMP.
- Quét toàn bộ `src/**` cho `chromium.launch`, `launchPersistentContext`, `.newContext(` và các biến thể Firefox/WebKit/CDP: chỉ có **một vị trí**, `src/lib/playwright/browser-manager.ts:139`, gọi `chromium.launchPersistentContext(this.profileDir, ...)`; profile vẫn là `./playwright-auth`. [static-inspection.json](s8-round2/static-inspection.json).
- Không còn import Chromium/khởi tạo context trong hai bộ xử lý ảnh. Chuẩn hóa PNG dùng Node/zlib; JPEG/WEBP/GIF dùng QImage. Đã thử **contain và cover** cho PNG/JPEG/WEBP/GIF, đầu ra đúng **960×540**; buffer lỗi trả null, mảng rỗng trả mảng rỗng.
- API chụp hàng loạt gọi `SequentialTaskQueue.getInstance().enqueue` với `jobType: "UPLOAD_SPCK"`. Ca hai yêu cầu đồng thời giữ yêu cầu thứ hai trong hàng đợi; số lượt `execute` chạy đồng thời tối đa **1**, cả hai trả **200**.
- Stop trước batch trả `TASK_CANCELLED` trước khi đọc repository. Stop sau học viên đầu ngăn chụp học viên thứ hai và ném lại `TASK_CANCELLED`. Yêu cầu mới khi hàng đợi đã Stop bị từ chối `QUEUE_STOPPED` (HTTP 500 theo xử lý hiện tại của route).
- Bộ dựng HTML mới dùng QTextDocument/QImage/QPainter offline, không đưa HTML học viên vào context đăng nhập.

**Kết luận:** Đóng S8-02 về việc tạo context phụ và thiếu hàng đợi/Stop. Ranh giới đọc tài nguyên của bộ dựng mới có lỗi riêng bên dưới, nên việc đóng phát hiện gốc không đủ để nghiệm thu bản sửa tổng thể.

## 4. S8-R2-01 — HIGH OPEN — Bộ dựng HTML mới đọc ảnh ngoài Path Allowlist

**Nguyên nhân:** Bộ tiền xử lý HTML chỉ thay thế `<img src="...">` hoặc dạng dấu nháy đơn tại dòng 965. Các thuộc tính không có dấu nháy, `body background` và `background-image:url(...)` vẫn được chuyển nguyên vẹn vào **QTextDocument mặc định**. `QTextDocument` tự đọc tài nguyên `file:///...` mà không đi qua `resolveSafeStaticFile` hoặc `assertPathAllowed`.

**Vị trí:** `src/lib/local-files/spck-app-screenshotter.ts:964`–`:975` (biểu thức lọc `img`), `:1017` (khởi tạo QTextDocument không chặn bộ nạp tài nguyên), `:1021` (`doc.setHtml(html)`), `:1053` (truyền HTML sang Python).

**Tái hiện chỉ bằng dữ liệu giả:**

1. Tạo `allowed/` và `denied/` cùng dưới một fixture TEMP; cấu hình chỉ cho phép `allowed/` cùng workspace mirror.
2. Tạo ảnh đỏ **600×400** tại `denied/SYNTHETIC_PRIVATE_IMAGE.png`. `isPathAllowed(image) === false`; gọi resolver theo đường dẫn thoát vùng trả **403**.
3. Tạo HTML trong `allowed/` dùng lần lượt ba dạng bên dưới. Gọi hàm thật `captureStudentAppScreenshots(..., useAiVision: false)`.
4. Đọc PNG kết quả để đếm điểm ảnh đỏ. Cả ba dạng đều tái hiện ảnh giả bị cấm trong ảnh đầu ra **960×540**.

```html
<img src=file:///C:/.../denied/SYNTHETIC_PRIVATE_IMAGE.png width=600 height=400>
<body background="file:///C:/.../denied/SYNTHETIC_PRIVATE_IMAGE.png">...</body>
<body style="background-image:url(file:///C:/.../denied/SYNTHETIC_PRIVATE_IMAGE.png)">...</body>
```

| Ca | Điểm ảnh đỏ trong PNG | Chính sách |
|---|---:|---|
| Đối chứng không có ảnh | 0 | PASS |
| `img src` có dấu nháy, bị lọc như dự kiến | 0 | PASS |
| `img src` không có dấu nháy | **106.134** | **FAIL** |
| `body background` | **517.221** | **FAIL** |
| CSS `background-image` | **517.518** | **FAIL** |

Mã dò: [renderer-resource-probe.cjs](s8-round2/renderer-resource-probe.cjs). Kết quả: [renderer-resources.json](s8-round2/renderer-resources.json), [log](s8-round2/renderer-resources.log). Đã xem trực tiếp PNG [ảnh bị đọc ngoài vùng](s8-round2/screenshots/unquoted-outside-image.png) và giữ [ảnh đối chứng](s8-round2/screenshots/control.png). Không dùng ảnh/file riêng tư thật của Owner.

**Tác động:** HTML của học viên có thể khiến bot đọc một ảnh có đường dẫn biết trước ngoài phạm vi được phép và đưa ảnh đó vào ảnh chụp SPCK. Đây là việc vượt ranh giới đọc tệp đã được tái hiện. **Suy luận từ mã, chưa gửi thật:** với `useAiVision` mặc định bật, ảnh chụp còn có thể đi vào Gemini Vision (`:1187`, `:1210`, `:1367`); ảnh chụp cũng trở thành tài nguyên nộp SPCK sau đó. Không tuyên bố đã khai thác đọc mọi loại tệp, đã gửi dữ liệu thật hoặc đã xảy ra rò rỉ thực tế.

**Hướng sửa tối thiểu:** Chặn ở **tầng nạp tài nguyên của QTextDocument**: chỉ cung cấp ảnh/CSS đã được kiểm đường dẫn thực trong TypeScript qua resolver, đưa dữ liệu được duyệt vào bộ nhớ và từ chối mọi tài nguyên khác. Không để `loadResource` mặc định tự mở đường dẫn file/UNC/mạng. Chỉ mở rộng biểu thức tìm `img` sẽ còn bỏ sót các dạng HTML/CSS khác. Giữ Node/PyQt6, một persistent context, hàng đợi và Stop hiện tại; không cần khôi phục context phụ hay sửa AGENTS/GEMINI.

**Điều kiện đóng:** Ba ca đọc ảnh ở trên phải không còn đọc được ảnh giả bị cấm; tài nguyên hợp lệ trong lớp vẫn hiển thị; kiểm cả dấu nháy/không dấu nháy, nền HTML/CSS và junction. Chạy lại bốn lệnh bắt buộc và hai probe chính sách theo phạm vi ảnh hưởng. Lần audit này chỉ ghi nhận và đưa hướng sửa, không sửa `src/**`.

## 5. Bảng lệnh xác minh

Các lệnh dưới chạy trong mirror TEMP, với biến cô lập và guard nêu ở mục 1. Giữ nguyên bài kiểm thử sản phẩm. [gates.json](s8-round2/gates.json) lưu lượt chạy đầu, [followup-gates.json](s8-round2/followup-gates.json) lưu diễn giải các lượt bổ sung.

| Lệnh | Exit | Kết quả | Bằng chứng |
|---|---:|---|---|
| `npx tsc --noEmit --incremental false` | **0** | PASS, 3,45s | [tsc.log](s8-round2/tsc.log) |
| `npx tsx scripts/test-spck-v272.ts` | **0** | **V01–V16 PASS**, 17,99s; ảnh/HTML 960×540, YouTube giả, bảo toàn ảnh cũ, junction | [spck-v272.log](s8-round2/spck-v272.log) |
| `npx tsx scripts/test-streamline-v340-s5.ts` | **0** | PASS, 7,23s | [s5.log](s8-round2/s5.log) |
| `npx tsx scripts/test-streamline-v340-s7.ts` | **0** | **S7-T1–T6 PASS**, 3,22s | [s7.log](s8-round2/s7.log) |
| `npx tsx path-probe.cjs` — nguyên bản Round 1 | **0** | **403, policyPass true** | [path-probe.log](s8-round2/path-probe.log) |
| `npx tsx browser-policy-probe.cjs` — nguyên bản Round 1 | **0** | **0 launch/context phụ; strict policy true** | [browser-policy-probe.log](s8-round2/browser-policy-probe.log) |
| `npx tsx edge-probe.cjs` — lượt đầu | **1** | 19/20; cấu hình probe tự loại DB TEMP khỏi allowlist | [kết quả đầu](s8-round2/edge-results-first.json), [log đầu](s8-round2/edge-probe-first.log) |
| `npx tsx edge-probe.cjs` — chẩn đoán | **1** | Giữ nguyên lỗi để thu thông báo: DB TEMP ngoài allowlist | [chẩn đoán](s8-round2/edge-results-diagnostic.json) |
| `npx tsx edge-probe.cjs` — cấu hình probe đã sửa | **0** | **20/20 PASS**, chỉ thêm đúng DB TEMP vào cấu hình giả | [kết quả cuối](s8-round2/edge-results.json), [log cuối](s8-round2/edge-probe.log) |
| `npx tsx renderer-resource-probe.cjs` | **1** | **2 đối chứng PASS / 3 ca bảo mật FAIL** | [kết quả](s8-round2/renderer-resources.json) |
| Quét tĩnh toàn bộ `src/**` về nơi tạo context | **0** | Chỉ `browser-manager.ts:139` | [static-inspection.json](s8-round2/static-inspection.json) |

Lỗi lượt đầu của probe mở rộng thuộc cấu hình bài dò do auditor tạo: khi thu hẹp allowlist, đã bỏ quên tệp SQLite TEMP. Đã lưu bằng chứng đầu/chẩn đoán, chỉ sửa probe trong thư mục audit rồi chạy lại; **không sửa mã ứng dụng hoặc scripts sản phẩm**. Không coi đây là lỗi hàng đợi sản phẩm. Ngược lại, ba ca renderer thất bại là lỗi sản phẩm có ảnh đầu ra đối chứng, không phải lỗi chuẩn bị fixture.

**Không chạy lại tám bộ/toàn bộ build:** đã chứng minh chỉ bốn tệp Round 2 thay đổi so với snapshot Round 1. Kết quả Round 1 gồm tám cổng, Webpack và 116/116 ẩn danh được kế thừa đúng phạm vi lịch sử, không ghi là lần chạy mới. Các hồ sơ S0–S7 vẫn được ghi nhận theo Round 1; không mở rộng lần này thành audit lại mọi chặng.

## 6. Bảo toàn dữ liệu và mã nguồn

Chỉ dùng **`Get-FileHash -Algorithm SHA256`** trên hai tệp thật theo ngoại lệ Owner cho phép, trước và sau toàn bộ kiểm thử/probe. Không kết nối SQLite, đọc JSON để phân tích, sao chép hoặc sửa hai tệp này.

| Tệp thật | SHA-256 trước và sau | Kết quả |
|---|---|---|
| `data/mindx_bot.db` | `A911EB02CD6E2610340604DCF42D53AFB428C50C02727C4CE44F138DEC9C8F16` | **Khớp kỳ vọng, không đổi** |
| `data/running_classes.json` | `ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2` | **Khớp kỳ vọng, không đổi** |

Bằng chứng: [production-before.json](s8-round2/production-before.json), [production-after.json](s8-round2/production-after.json), [final-verification.json](s8-round2/final-verification.json).

**2.042/2.042 tệp được bảo vệ giữ nguyên trong audit**, gồm toàn bộ `src/**`, `scripts/**`, `AGENTS.md`, `GEMINI.md`, `next-env.d.ts`, package/tsconfig, các hồ sơ round-12–round-41 và toàn bộ `s8-final/`. Không có tệp đổi/thêm trong tập bảo vệ. [protected-before.json](s8-round2/protected-before.json), [preservation.json](s8-round2/preservation.json).

Chỉ thêm báo cáo/bằng chứng `s8-round2/`, cập nhật đầu báo cáo S8 gốc và đầu ba tài liệu tiến độ. Toàn bộ báo cáo Round 1 được giữ nguyên từng byte dưới phần trạng thái mới. Các tài liệu trước audit được giữ tại [documents-before/](s8-round2/documents-before/). Không ghi đè thay đổi có sẵn của Owner/agent triển khai.

## 7. Quyết định và bước tiếp theo

**Đã làm:** Đóng hai phát hiện cũ bằng kiểm tra mã và chạy thực tế trong TEMP; hoàn tất bốn lệnh bắt buộc, hai probe gốc và probe bổ sung; ghi nhận một lỗi HIGH mới trong chính phần thay thế.

**Kết quả:** **NO-GO S8/v3.4.0; 2/2 mục cũ CLOSED, 1 HIGH mới OPEN.** Không xác nhận GO chỉ dựa trên test xanh hoặc số lượng context.

**Chưa kiểm tra:** LMS/Teaching/Gemini/YouTube/Drive thật, thao tác với lớp thật, số lần bấm và thời gian tiết kiệm. QTextDocument chỉ dựng HTML tĩnh; các phép kiểm kích thước ảnh không chứng minh bố cục CSS hiện đại hoặc JavaScript giống trình duyệt. Chưa xác nhận bằng chạy thử sau một bản sửa mới cho S8-R2-01 vì bản sửa đó chưa có.

**Việc tiếp theo:** Agent triển khai chặn bộ nạp tài nguyên Qt theo mục 4, rồi tái kiểm đúng lỗi mới và các luồng ảnh liên quan. Owner chưa cần thao tác kỹ thuật hoặc thử ghi dữ liệu thật để xử lý phát hiện này.
