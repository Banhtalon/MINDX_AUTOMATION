# Final Acceptance Closure Audit — v3.4.0 — S8 Round 4

**VERDICT: GO — đủ điều kiện đóng Stage S8 trong phạm vi kiểm định cục bộ.**

**S8-01: CLOSED. S8-02: CLOSED. S8-R2-01: CLOSED. S8-R3-01: CLOSED. S8-R3-02: CLOSED.** Toàn bộ **5/5 phát hiện đã đóng**; không còn phát hiện mở trong tập điều kiện nghiệm thu được giao cho Round 4.

Ngày: **30/10/2026**, Asia/Saigon. Codex trực tiếp thực hiện kiểm định độc lập theo yêu cầu của Owner; không gán kết quả cho reviewer khác chưa chạy. Áp dụng `verify-and-stop`: chỉ kiểm chứng và cập nhật tài liệu được yêu cầu, không sửa mã sản phẩm, không commit/push, không gọi dịch vụ thật.

## 1. Phạm vi, bản sửa và cô lập

- HEAD: `faf9fbc775b56bed79c766720589783b08fcee5c` cộng thay đổi có sẵn trong cây làm việc. Đã lưu [trạng thái đầu](s8-round4/git-status-before.txt); không ghi đè thay đổi có sẵn của Owner.
- So với snapshot mã nguồn/cấu hình Round 3, chỉ `src/lib/local-files/spck-app-screenshotter.ts` thay đổi. Đối chiếu bản nguồn TEMP Round 3 đã xác nhận đúng SHA-256: bản sửa có **10 dòng thêm, 3 dòng bỏ**, tương ứng tiền tố ngẫu nhiên, giữ URI đã duyệt và bỏ dấu nháy trong `url(...)`. Đây là thay đổi có trước audit, không phải do auditor sửa. [Đối chiếu nguồn](s8-round4/source-comparison.json), [diff chính xác](s8-round4/round4-source.diff).
- SHA-256 nguồn được kiểm: `4B3CD6C194DAAC028B45EEFBFB65DF7DA89D8A94ACED5A4FDD161DE9AAB483C6`.
- Chạy toàn bộ kiểm thử trên bản sao TEMP `C:\Users\QQ\AppData\Local\Temp\mindx-s8-r4-s_nmn8xk`. Nguồn `src/**` khớp workspace trước/sau. Không chép `.env`, dữ liệu vận hành, cache, hồ sơ đăng nhập hoặc `teacher_browsed_dirs.json`. Chỉ chép ba tài nguyên cấu hình tĩnh cần cho suite: ảnh bìa mặc định, barem và mẫu Zalo. Dùng thư viện đã cài qua junction; `npx` ở chế độ offline, không cài/cập nhật thư viện.
- Node bị chặn kết nối mạng ngoài; Chromium của bài kiểm giao diện chạy offline, chặn cả HTTP/HTTPS. Python/PyQt6 chỉ dựng ảnh giả offline; `SafeTextDocument` không tự tải tài nguyên. Các lời gọi AI/YouTube trong suite dùng dữ liệu giả có sẵn của suite. Không gọi LMS, Teaching hoặc Gemini thật.
- Sáu probe cũ được chép nguyên vẹn vào TEMP, SHA-256 bản gốc và bản chạy khớp nhau. [Hash probe](s8-round4/probe-copy-hashes.json), [cấu hình cô lập](s8-round4/isolation.json), [runner](s8-round4/run-audit.py).

Mọi tiến trình kiểm thử nhận các biến sau trước khi đọc cấu hình:

```powershell
$env:ALLOWED_LOCAL_DIRS = $env:TEMP
$env:MINDX_DB_PATH = "$env:TEMP\mindx_codex_s8_r4.db"
$env:MINDX_RUNNING_CLASSES_PATH = "$env:TEMP\mindx_codex_s8_r4_rc.json"
$env:GEMINI_API_KEY = "test-s8-dummy-key"
```

Đã loại biến tài khoản/mật khẩu khỏi môi trường con. Các probe tự thu hẹp phạm vi xuống thư mục `allowed/` giả để có đối chứng bị cấm; edge giữ thêm đúng tệp SQLite TEMP. Suite S7 có bước tự chuyển sang DB/JSON giả trong thư mục TEMP riêng rồi khôi phục biến ban đầu; không chuyển về dữ liệu Owner.

## 2. Kết quả đóng hai lỗi MEDIUM Round 3

### S8-R3-01: CLOSED — ảnh nền trong thuộc tính style

**Nguyên nhân cũ:** `url("mem://...")` đóng sớm thuộc tính HTML dùng dấu nháy kép, khiến mất ảnh hợp lệ.

**Bản sửa đã kiểm:** `rewriteCssUrls` tại `src/lib/local-files/spck-app-screenshotter.ts:1022` sinh `url(${memUri})`; URI do chương trình tạo không chứa ký tự cần bao nháy. Không thay đổi quyền đọc tệp.

**Kết quả chạy mới:** Probe tương thích cho ca `style="background-image:url(images/red.png)"` đạt **518.022 điểm đỏ**, trước đây là 0. Probe payload chạy nguyên bản cũng cho cả **nháy kép, nháy đơn và khối `<style>` đạt 518.022 điểm đỏ/ca**, có ảnh thực 960×540. Payload nháy kép có dạng hợp lệ:

```html
<body style="background-image:url(mem://asset_8768b2a57731_0)"><p>synthetic</p></body>
```

[Payload và đối chứng](s8-round4/renderer-payload.json), [ảnh nháy kép](s8-round4/images/payload-inline-double.png), [ảnh nháy đơn](s8-round4/images/payload-inline-single-control.png). Đã xem trực tiếp PNG của ca nháy kép và đối chứng junction bị chặn.

### S8-R3-02: CLOSED — ảnh từ stylesheet liên kết

**Nguyên nhân cũ:** Sau khi inline CSS và duyệt ảnh, bước viết lại toàn trang xử lý URL lần hai rồi thay URI đã duyệt thành `none`.

**Bản sửa đã kiểm:** Tiền tố được tạo bằng `crypto.randomBytes(6)` tại dòng 979; nhánh dòng 988–993 chỉ giữ nguyên URI vừa có đúng tiền tố của lần dựng hiện tại, vừa tồn tại trong `approvedResources` qua kiểm tra thuộc tính riêng. URI không thỏa vẫn đi qua bộ kiểm đường dẫn hiện hành; không mở quyền tùy ý cho scheme `mem:`. Bốn lần dựng trong probe payload sinh bốn tiền tố khác nhau; đó là quan sát thực tế, không phải chứng minh xác suất ngẫu nhiên.

**Kết quả chạy mới:** Cả `<link rel="stylesheet" href="css/site.css">` và `<link rel=stylesheet href=css/site.css>` đạt **518.022 điểm đỏ/ca**, trước đây là 0. CSS dùng đường dẫn tương đối `../images/red.png` từ thư mục con `css/`. Payload sau tiền xử lý vẫn giữ `background-image:url(mem://asset_62eb2cd21d14_0)` và có đúng tài nguyên ảnh **1.606 byte** trong bảng đã duyệt. Cùng hai dạng link qua junction đến thư mục bị cấm đều có **0 điểm đỏ**.

[Kết quả tương thích](s8-round4/renderer-compatibility.json), [payload thực](s8-round4/renderer-payload.json), [ảnh link không nháy](s8-round4/images/allowed-stylesheet-unquoted.png). Đã xem trực tiếp PNG của ca link không nháy.

## 3. Ma trận ảnh hợp lệ và junction — 14/14 PASS

Ảnh giả đỏ 600×400; mỗi ảnh đầu ra phải có kích thước 960×540 và `capturedCount > 0`. Ca hợp lệ phải có `redPixels > 1000`; ca junction trỏ sang `denied/` phải có `redPixels === 0`. Có đối chiếu resolver cho từng ca; không dùng đầu ra rỗng để tính PASS.

| Dạng tham chiếu | Điểm đỏ hợp lệ | Điểm đỏ qua junction bị cấm | Kết quả |
|---|---:|---:|---|
| `img src` có nháy | 106.134 | 0 | PASS |
| `img src` không nháy | 106.134 | 0 | PASS |
| `body background` | 518.022 | 0 | PASS |
| `style="background-image:url(...)"` | 518.022 | 0 | PASS |
| Khối `<style>` | 518.022 | 0 | PASS |
| Link stylesheet có nháy | 518.022 | 0 | PASS |
| Link stylesheet không nháy | 518.022 | 0 | PASS |

**7/7 hiển thị ảnh hợp lệ + 7/7 chặn junction = 14/14 PASS, 0 FAIL.** [JSON đầy đủ](s8-round4/renderer-compatibility.json), [ảnh được giữ trong hồ sơ](s8-round4/images/).

## 4. Ba phát hiện cũ tiếp tục CLOSED

| Phát hiện | Bằng chứng mới | Trạng thái |
|---|---|---|
| S8-01 | Path probe trả **403**, `policyPass: true`, không đăng ký thư mục bị cấm; edge kiểm traversal, junction, metadata và thư mục hợp lệ | **CLOSED** |
| S8-02 | Browser probe ghi **0 standalone launch, 0 context mới**, `strictSinglePersistentContextPolicyPass: true`; edge xác nhận hàng đợi tuần tự và Stop trước batch/giữa học viên | **CLOSED** |
| S8-R2-01 | Renderer resource probe **5/5 policyPass**; mọi ca `file://` bị cấm có `redPixels === 0`; thêm **7/7** ca junction bị chặn, trong khi đối chứng ảnh hợp lệ hiển thị | **CLOSED** |

Đọc và quét lại `src/**`: chỉ một nơi tạo persistent context tại `src/lib/playwright/browser-manager.ts:139`; không phát hiện standalone launch/context phụ trong nguồn sản phẩm. Route capture vẫn gọi `SequentialTaskQueue.getInstance().enqueue` với `jobType: "UPLOAD_SPCK"`. `ensureCaptureNotStopped()` vẫn kiểm đầu batch, từng học viên và lượt HTML; `TASK_CANCELLED` được ném lại. `SafeTextDocument.loadResource` tại dòng 1110 chỉ trả ảnh trong `approved_images`, trả `None` cho URL khác; không gọi bộ nạp mặc định của lớp cha. [Kiểm tra tĩnh](s8-round4/static-inspection.json).

Bằng chứng động: [path](s8-round4/path-probe.json), [browser](s8-round4/browser-policy-probe.json), [renderer resource](s8-round4/renderer-resources.json), [edge](s8-round4/edge-results.json). Browser probe là phép thử dùng đối tượng giả cho nhánh chuẩn hóa ảnh; không coi riêng nó là kiểm chứng toàn bộ runtime trình duyệt.

## 5. Bảng lệnh kiểm chứng mới

Các lệnh chạy từ bản sao TEMP nêu trên. Tên probe trong bảng là bản chép nguyên mã của đường dẫn gốc, không phải probe được sửa để đạt kết quả.

| Lệnh | Probe gốc / phạm vi | Exit | Kết quả | Log |
|---|---|---:|---|---|
| `npx tsx renderer-compatibility-probe.cjs` | `s8-round3/renderer-compatibility-probe.cjs`, có `AUDIT_COMPAT_OUT` | 0 | **14/14 PASS** | [log](s8-round4/renderer-compatibility-probe.log) |
| `npx tsx renderer-payload-probe.cjs` | `s8-round3/renderer-payload-probe.cjs`, có `AUDIT_PAYLOAD_OUT` | 0 | **4/4 ca có ảnh**, mỗi ca 518.022 điểm đỏ; quan sát payload trước Python | [log](s8-round4/renderer-payload-probe.log) |
| `npx tsx renderer-resource-probe.cjs` | `s8-round2/renderer-resource-probe.cjs` | 0 | **5/5 policyPass**, 0 FAIL | [log](s8-round4/renderer-resource-probe.log) |
| `npx tsx path-probe.cjs` | `s8-final/path-probe.cjs` | 0 | **403, policyPass true** | [log](s8-round4/path-probe.log) |
| `npx tsx browser-policy-probe.cjs` | `s8-final/browser-policy-probe.cjs` | 0 | **0 launch, 0 context, strict policy true** | [log](s8-round4/browser-policy-probe.log) |
| `npx tsx edge-probe.cjs` | `s8-round2/edge-probe.cjs` | 0 | **20/20 PASS** | [log](s8-round4/edge-probe.log) |
| `npx tsc --noEmit --incremental false` | Kiểm tra TypeScript trên nguồn sao chép khớp | 0 | **PASS** | [log](s8-round4/tsc.log) |
| `npx tsx scripts/test-spck-v272.ts` | Suite SPCK nguyên bản | 0 | **V01–V16 PASS** | [log](s8-round4/spck-v272.log) |
| `npx tsx scripts/test-streamline-v340-s5.ts` | Suite S5b nguyên bản | 0 | **S5b-T1–T4 PASS** | [log](s8-round4/s5.log) |
| `npx tsx scripts/test-streamline-v340-s7.ts` | Suite S7 nguyên bản | 0 | **S7-T1–T6 PASS** | [log](s8-round4/s7.log) |

**10/10 lệnh exit 0 ngay lượt đầu; không sửa nguồn/test và không chạy lại để thay kết quả.** [Lệnh, thời gian, thư mục chạy](s8-round4/gates.json). Probe payload là quan sát chẩn đoán, không tự có điều kiện assert 4/4; auditor đã đọc JSON và kiểm số điểm đỏ. Tương tự, đã đọc trường chính sách trong JSON path/browser, không suy ra PASS chỉ từ exit 0.

Không chạy lại build production hoặc toàn bộ tám suite lịch sử S1–S7; kết quả cũ được giữ làm lịch sử, không trình bày như lần chạy Round 4. Quyết định GO này đóng các phát hiện S8 còn lại trên bản nguồn đã định danh, không thay thế việc vận hành với lớp thật.

## 6. Bảo toàn dữ liệu và hồ sơ

Chỉ dùng **`Get-FileHash -Algorithm SHA256`** đọc hai tệp thật trước/sau kiểm thử; không mở SQLite, không phân tích nội dung JSON, không sao chép và không sửa chúng.

| Tệp thật | SHA-256 trước = sau = kỳ vọng | Kết quả |
|---|---|---|
| `data/mindx_bot.db` | `A911EB02CD6E2610340604DCF42D53AFB428C50C02727C4CE44F138DEC9C8F16` | **Bảo toàn 100%** |
| `data/running_classes.json` | `ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2` | **Bảo toàn 100%** |

[Hash trước](s8-round4/production-before.json), [hash sau](s8-round4/production-after.json).

**2.951/2.951 tệp bất biến được bảo vệ giữ nguyên**, gồm `src/**`, `scripts/**`, `AGENTS.md`, `GEMINI.md`, `next-env.d.ts`, cấu hình package/tsconfig và hồ sơ audit cũ. Snapshot thô có 2.953 mục do có thêm hai tệp `.stdout.log`/`.stderr.log` của chính phiên Round 4; `.stderr.log` tăng trong lúc chạy, được ghi rõ và loại khỏi tập hồ sơ lịch sử bất biến. Auditor không ghi đè hai log do tiến trình phiên làm việc quản lý. [Snapshot trước](s8-round4/protected-before.json), [đối chiếu thô sau kiểm thử](s8-round4/preservation.json), [xác nhận cuối](s8-round4/final-verification.json).

Chỉ thêm báo cáo này/bằng chứng trong `s8-round4/`, cập nhật đầu `CODEX_V340_FINAL.md` và ba tài liệu trạng thái theo yêu cầu. Đã lưu [bản tài liệu trước cập nhật](s8-round4/documents-before/). Sửa tiếng Việt của đoạn lịch sử Round 3 bị dấu `?` trong bốn tài liệu được phép cập nhật; không sửa báo cáo Round 3 hoặc các hồ sơ audit cũ khác.

## 7. Quyết định nghiệm thu

**Đã làm:** Kiểm chứng hai bản sửa Round 4 bằng probe nguyên bản, chạy mới đủ bộ lệnh yêu cầu, đối chiếu mã nguồn và hash dữ liệu thật, lưu log/JSON/PNG và cập nhật tài liệu bằng UTF-8.

**Kết quả:** **VERDICT: GO; 5/5 CLOSED.** Đủ bằng chứng đóng Stage S8 cho v3.4.0 trong phạm vi kiểm định cục bộ đã giao. Không còn yêu cầu sửa mã để đóng năm phát hiện này.

**Chưa kiểm tra:** LMS/Teaching/Gemini/YouTube/Drive thật, lớp thật, số lần bấm/thời gian tiết kiệm và build production mới. Bộ dựng Qt xử lý HTML tĩnh; không xác nhận tương thích toàn bộ CSS/JavaScript như trình duyệt.

**Việc tiếp theo:** Owner không cần thao tác kỹ thuật để đóng S8. Nếu triển khai kiểm tra vận hành thực tế, thực hiện thành đợt riêng theo [checklist lớp thật](OWNER_LIVE_TRIAL_CHECKLIST.md), với quyền và dữ liệu được Owner cho phép.
