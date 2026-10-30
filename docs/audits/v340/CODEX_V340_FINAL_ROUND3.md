# Final Acceptance Closure Audit — v3.4.0 — S8 Round 3

**VERDICT: NO-GO cho đóng S8/nghiệm thu cuối v3.4.0.**

**S8-01: CLOSED. S8-02: CLOSED. S8-R2-01: CLOSED — 3/3 phát hiện cũ đã đóng.** Tuy nhiên, kiểm tra bắt buộc về ảnh hợp lệ phát hiện **hai lỗi MEDIUM mới OPEN**: `S8-R3-01` làm mất ảnh nền trong thuộc tính `style="..."`; `S8-R3-02` làm mất ảnh nền từ tệp CSS liên kết. Vì thế không thể ghi GO theo kết quả thực tế.

Ngày: **30/10/2026**, Asia/Saigon. Codex trực tiếp thực hiện vai trò Independent Auditor theo yêu cầu `gpt-6.1-sol high`; không có phép đo riêng xác nhận model/mức suy luận, không gán kết quả cho reviewer khác chưa chạy. Áp dụng quy trình `verify-and-stop`; không sửa mã sản phẩm, không commit/push, không gọi dịch vụ thật.

## 1. Phạm vi và cô lập

- HEAD: `faf9fbc775b56bed79c766720589783b08fcee5c` cộng thay đổi có sẵn trong cây làm việc. [Trạng thái đầu](s8-round3/git-status-before.txt).
- Đối chiếu **2.042 tệp** trong snapshot Round 2: chỉ `src/lib/local-files/spck-app-screenshotter.ts` thay đổi; **2.041 tệp còn lại khớp**, không thêm nguồn/test sản phẩm. SHA-256 tệp đã sửa: `E09F8093A92A5C6729BE69D0E45512CECEEF19CE9EF42EFFD429EE723A2AE810`. [So sánh](s8-round3/round2-comparison.json).
- Chạy trên bản sao TEMP `C:\Users\QQ\AppData\Local\Temp\mindx-s8-r3-8_fb9w4e`, nguồn `src/` khớp workspace trước/sau. Không chép `.env`, DB/cache vận hành, registry thư mục giáo viên hoặc `playwright-auth`; dùng thư viện hiện có qua junction. [Cô lập](s8-round3/isolation.json), [runner](s8-round3/run-audit.py).
- Toàn bộ lệnh kiểm thử nhận cấu hình bên dưới từ tiến trình cha; runner cũng đặt lại các giá trị này cho tiến trình con. Bỏ biến tài khoản/mật khẩu thật khỏi môi trường con. Node chặn kết nối mạng ngoài; S5 chỉ dùng Chromium với giao diện giả cục bộ. Các ca PyQt6 chỉ dùng HTML/CSS/ảnh giả offline.

```powershell
$env:ALLOWED_LOCAL_DIRS = $env:TEMP
$env:MINDX_DB_PATH = "$env:TEMP\mindx_codex_s8_r3.db"
$env:MINDX_RUNNING_CLASSES_PATH = "$env:TEMP\mindx_codex_s8_r3_rc.json"
$env:GEMINI_API_KEY = "test-s8-dummy-key"
```

Các probe thu hẹp `config.allowedLocalDirs` trong tiến trình thử nghiệm xuống `allowed/` giả để kiểm tra bị cấm. Probe edge giữ thêm đúng tệp SQLite TEMP như bản Round 2, không mở lại toàn bộ TEMP cho đối chứng âm. Không truy cập dữ liệu lớp thật.

## 2. Trạng thái các phát hiện cũ

| Phát hiện | Kết quả mới | Trạng thái |
|---|---|---|
| S8-01 — duyệt thư mục ngoài phạm vi | Probe nguyên bản trả **403**, `policyPass: true`, không đăng ký thư mục bị cấm; edge kiểm traversal/junction/metadata | **CLOSED** |
| S8-02 — context riêng, thiếu hàng đợi/Stop | **0** standalone launch, **0** context mới, `strictSinglePersistentContextPolicyPass: true`; edge xác nhận tuần tự và Stop | **CLOSED** |
| S8-R2-01 — Qt tự đọc ảnh ngoài phạm vi | Probe nguyên bản **5/5 policyPass**, mọi ảnh bị cấm **redPixels = 0**; thêm **7/7** ca junction thoát vùng đều 0 | **CLOSED** |

Đã đọc `SafeTextDocument.loadResource` tại `src/lib/local-files/spck-app-screenshotter.ts:1102`: chỉ trả QImage từ `approved_images`; URL khác trả `None`, không gọi bộ nạp mặc định của lớp cha. Tài nguyên hợp lệ được chuyển thành byte base64 trong bộ nhớ; đường dẫn tệp được kiểm qua `resolveSafeStaticFile`, gồm kiểm phạm vi và đích thật sau junction. Không dùng kết quả “không thấy màu đỏ” riêng lẻ để kết luận: đối chứng ảnh hợp lệ trong `img`/`body`/`style` vẫn có màu đỏ rõ ràng.

Quét toàn bộ `src/**` về `launchPersistentContext`, `chromium/firefox/webkit.launch`, `.newContext(`, `connectOverCDP`: chỉ **một nơi tạo context**, `src/lib/playwright/browser-manager.ts:139`. Route `/api/spck/capture-screenshots` vẫn `enqueue` với `jobType: "UPLOAD_SPCK"`; `ensureCaptureNotStopped()` vẫn kiểm trước batch/từng học viên và ném lại `TASK_CANCELLED`. [Kiểm tra tĩnh](s8-round3/static-inspection.json).

Bằng chứng: [renderer gốc](s8-round3/renderer-resources.json), [path](s8-round3/path-probe.json), [browser](s8-round3/browser-policy-probe.json), [20 ca edge](s8-round3/edge-results.json).

## 3. Kiểm tra ảnh hợp lệ và junction

Ảnh giả màu đỏ **600×400**; ảnh đầu ra **960×540**. Mỗi ca hợp lệ có ảnh trong thư mục dự án bên trong `allowed/`; mỗi ca junction dùng cùng đường dẫn nhưng thư mục `images/` trỏ sang `denied/`. Quy tắc: ảnh hợp lệ cần hơn 1.000 điểm đỏ; ảnh bị cấm phải đúng 0. Đã xác nhận resolver cho phép/từ chối tương ứng. Không coi đầu ra rỗng hoặc không chụp được là PASS.

| Dạng tham chiếu | Điểm đỏ khi hợp lệ | Điểm đỏ khi junction sang denied | Kết quả |
|---|---:|---:|---|
| `<img src="images/red.png">` | 106.134 | 0 | PASS |
| `<img src=images/red.png>` | 106.134 | 0 | PASS |
| `<body background="images/red.png">` | 518.022 | 0 | PASS |
| `style="background-image:url(images/red.png)"` | **0** | 0 | **FAIL ảnh hợp lệ** |
| `<style>body {background-image:url(...);}</style>` | 518.022 | 0 | PASS |
| `<link rel="stylesheet" href="css/site.css">` | **0** | 0 | **FAIL ảnh hợp lệ** |
| `<link rel=stylesheet href=css/site.css>` | **0** | 0 | **FAIL ảnh hợp lệ** |

Tệp CSS dùng `url(../images/red.png)`, đúng đường dẫn tương đối từ thư mục `css/`. Tổng **11/14 PASS, 3/14 FAIL**; gồm **7/7 chặn junction** và **4/7 hiển thị ảnh hợp lệ**. [Probe mới](s8-round3/renderer-compatibility-probe.cjs), [kết quả](s8-round3/renderer-compatibility.json), [ảnh bằng chứng](s8-round3/images/).

## 4. Hai phát hiện mới còn mở

### S8-R3-01 — MEDIUM OPEN — Dấu nháy làm hỏng CSS trong thuộc tính HTML

**Nguyên nhân:** `rewriteCssUrls` luôn sinh `url("mem://asset_N")`, rồi áp dụng trực tiếp lên toàn bộ HTML mà không xử lý dấu nháy bao quanh thuộc tính `style`. Dấu nháy kép mới đóng thuộc tính sớm, làm mất ảnh nền hợp lệ.

**Vị trí:** `src/lib/local-files/spck-app-screenshotter.ts:1016` và `:1034`.

**Tái hiện:** `<body style="background-image:url(images/red.png)">` được chuyển thực tế thành:

```html
<body style="background-image:url("mem://asset_0")">
```

Ngay trước khi gọi Python, `resources` vẫn có `mem://asset_0` với **1.606 byte ảnh hợp lệ**, nhưng ảnh kết quả có **0 điểm đỏ**. Đối chứng chỉ đổi dấu bao thuộc tính thành nháy đơn, giữ nguyên ảnh và cách viết CSS: **518.022 điểm đỏ**. `<style>` cũng đạt cùng 518.022. Đây là lỗi tiền xử lý HTML, không phải thiếu ảnh hoặc Qt không hỗ trợ thuộc tính.

**Cách sửa nhỏ nhất đề nghị:** Viết lại `url(...)` theo cách giữ HTML/CSS hợp lệ trong cả thuộc tính dùng nháy kép, nháy đơn và khối `<style>`; URI `mem://asset_N` do hệ thống sinh có thể được biểu diễn không cần dấu nháy trong `url(...)`. Không nới quyền đọc tệp.

**Kiểm tra sau sửa:** Ca nháy kép/đơn và `<style>` đều phải có ảnh; các ca `file://`/junction vẫn đúng 0 điểm đỏ.

### S8-R3-02 — MEDIUM OPEN — CSS từ tệp liên kết bị xử lý hai lần, xóa ảnh đã duyệt

**Nguyên nhân:** Khi inline `<link>`, mã đã gọi `rewriteCssUrls` theo thư mục chứa CSS và sinh `mem://asset_0`. Sau đó bước viết lại toàn bộ HTML gọi hàm này lần hai. `registerApprovedImageRef` không nhận URI đã duyệt này; `resolveLocalAsset` từ chối scheme `mem:`, nên thay ảnh bằng `none`.

**Vị trí:** `src/lib/local-files/spck-app-screenshotter.ts:1029`–`:1034`, liên quan `:938`/`:979`.

**Tái hiện:** `css/site.css` có `body{background-image:url(../images/red.png);}`. Cả link có/không có nháy đều mất ảnh. Dữ liệu thực ngay trước Python:

```html
<style>
body{background-image:none;}
</style>
```

`resources["mem://asset_0"]` vẫn chứa **1.606 byte ảnh hợp lệ**; kết quả **0 điểm đỏ**. Cùng CSS đặt trực tiếp trong `<style>` chỉ bị xử lý một lần thì **518.022 điểm đỏ**.

**Cách sửa nhỏ nhất đề nghị:** Tránh xử lý lại URL đã chuyển đổi trong CSS inline, hoặc giữ nguyên chính xác URI có trong tập tài nguyên do lần xử lý hiện tại tạo. Không cho phép tùy ý `mem:`/scheme khác từ bài học viên và không gọi lại `super().loadResource`.

**Kiểm tra sau sửa:** Link có/không nháy, CSS ở thư mục con và `../images/` đều hiển thị ảnh hợp lệ; CSS trỏ junction sang `denied/` tiếp tục bị chặn.

**Bằng chứng chung:** [probe quan sát dữ liệu](s8-round3/renderer-payload-probe.cjs), [payload thực và đối chứng](s8-round3/renderer-payload.json), [log](s8-round3/renderer-payload-probe.log). Probe chỉ quan sát đầu vào `spawnSync` rồi gọi nguyên hàm gốc; không thay HTML hay nguồn ứng dụng để tạo kết quả. Đã xem trực tiếp PNG của ca mất ảnh và đối chứng có ảnh.

## 5. Bảng lệnh kiểm chứng mới

Tất cả chạy từ bản sao TEMP nói trên, nguyên mã nguồn và probe cũ. `npx` dùng bộ công cụ đã cài; không cài/cập nhật thư viện.

| Lệnh | Exit | Kết quả | Bằng chứng |
|---|---:|---|---|
| `npx tsx renderer-resource-probe.cjs` — nguyên bản s8-round2 | 0 | **5/5 policyPass**, mọi redPixels = 0 | [log](s8-round3/renderer-resource-probe.log) |
| `npx tsx path-probe.cjs` — nguyên bản s8-final | 0 | **403, policyPass true** | [log](s8-round3/path-probe.log) |
| `npx tsx browser-policy-probe.cjs` — nguyên bản s8-final | 0 | **0 launch, 0 context, strict policy true** | [log](s8-round3/browser-policy-probe.log) |
| `npx tsx edge-probe.cjs` — nguyên bản s8-round2 | 0 | **20/20 PASS**, gồm hàng đợi/Stop và định dạng ảnh | [log](s8-round3/edge-probe.log) |
| `npx tsc --noEmit --incremental false` | 0 | PASS | [log](s8-round3/tsc.log) |
| `npx tsx scripts/test-spck-v272.ts` | 0 | **V01–V16 PASS** | [log](s8-round3/spck-v272.log) |
| `npx tsx scripts/test-streamline-v340-s5.ts` | 0 | **S5b-T1–T3 PASS** | [log](s8-round3/s5.log) |
| `npx tsx scripts/test-streamline-v340-s7.ts` | 0 | **S7-T1–T6 PASS** | [log](s8-round3/s7.log) |
| `npx tsx renderer-compatibility-probe.cjs` — mới | **1** | **11/14 PASS, 3 FAIL** do mất ảnh hợp lệ | [log](s8-round3/renderer-compatibility-probe.log) |
| `npx tsx renderer-payload-probe.cjs` — chẩn đoán mới | 0 | Ghi 4 đầu vào renderer; 2 ca lỗi/2 đối chứng xác nhận hai nguyên nhân trên; **không phải cổng sản phẩm PASS** | [log](s8-round3/renderer-payload-probe.log) |

[Gates và thời gian](s8-round3/gates.json), [lượt chẩn đoán](s8-round3/payload-gate.json). Tám lệnh/probe bắt buộc đều đạt ngay lượt đầu; không chạy lại sau sửa vì không sửa mã. Không chạy build/toàn bộ tám suite lịch sử S1–S7, không trình bày bằng chứng cũ là lần chạy mới.

## 6. Bảo toàn dữ liệu, nguồn và lịch sử

Chỉ gọi **`Get-FileHash -Algorithm SHA256`** trên hai tệp thật, trước/sau kiểm thử. Không mở SQLite, đọc JSON để phân tích, sao chép hoặc sửa hai tệp này.

| Tệp thật | SHA-256 trước và sau | Kết quả |
|---|---|---|
| `data/mindx_bot.db` | `A911EB02CD6E2610340604DCF42D53AFB428C50C02727C4CE44F138DEC9C8F16` | **Khớp kỳ vọng, giữ nguyên 100%** |
| `data/running_classes.json` | `ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2` | **Khớp kỳ vọng, giữ nguyên 100%** |

[Trước](s8-round3/production-before.json), [sau](s8-round3/production-after.json).

**2.892/2.892 tệp bất biến được bảo vệ giữ nguyên**, gồm toàn bộ `src/**`, `scripts/**`, `AGENTS.md`, `GEMINI.md`, `next-env.d.ts`, cấu hình package/tsconfig và hồ sơ audit lịch sử. Snapshot thô có 2.894 mục vì còn ghi nhận hai tệp log `CODEX_V340_FINAL_ROUND3.stdout.log`/`.stderr.log` của phiên chạy hiện tại; `.stderr.log` tăng trong lúc làm việc, được tách rõ khỏi tập hồ sơ lịch sử bất biến. Auditor không ghi đè các log đó. [Snapshot trước](s8-round3/protected-before.json), [đo cuối kiểm thử thô](s8-round3/preservation.json), [xác nhận cuối](s8-round3/final-verification.json).

Chỉ tạo báo cáo/bằng chứng Round 3 và cập nhật đầu `CODEX_V340_FINAL.md`, `PROJECT_STATE.md`, `CHANGELOG.md`, `MINDX_AUTOMATION_PLAN.md`. Nội dung cũ giữ nguyên bên dưới; bản trước cập nhật ở [documents-before/](s8-round3/documents-before/). Không sửa bất kỳ tệp ứng dụng/test sản phẩm hoặc ghi đè thay đổi có sẵn của Owner.

## 7. Quyết định và việc tiếp theo

**Đã làm:** Kiểm định lại đủ tám lệnh/probe bắt buộc; đóng lỗi đọc tài nguyên Qt; bổ sung 14 ca ảnh hợp lệ/junction và 4 ca quan sát đầu vào có đối chứng.

**Kết quả:** **3/3 phát hiện cũ CLOSED; 2 MEDIUM mới OPEN; VERDICT: NO-GO.** Điều kiện ảnh hợp lệ trong nhiệm vụ chưa đạt, nên S8 chưa đóng.

**Chưa kiểm tra:** LMS/Teaching/Gemini/YouTube/Drive thật, lớp thật, số lần bấm/thời gian tiết kiệm, build production mới. Bộ dựng Qt là HTML tĩnh; không xác nhận mức tương thích CSS/JavaScript như trình duyệt.

**Việc tiếp theo:** Agent triển khai sửa hẹp hai nguyên nhân trong đúng `spck-app-screenshotter.ts`, giữ nguyên hàng rào `SafeTextDocument` và kiểm đường dẫn thật; sau đó kiểm lại Round 4 với probe ảnh hợp lệ và các cổng bắt buộc nêu trên. Owner chưa cần thao tác kỹ thuật. Audit này không tự sửa mã ứng dụng.
