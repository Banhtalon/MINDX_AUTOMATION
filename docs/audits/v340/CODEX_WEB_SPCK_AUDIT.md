# Kiểm định độc lập Web SPCK và tinh gọn `/final-project` — Round 2 Closure Audit

Ngày kiểm định: **03/11/2026** (Asia/Saigon). Vai trò: **Independent Quality & Safety Auditor**.

## Decision / Verdict

**VERDICT: GO** trong phạm vi kiểm định cục bộ đợt nâng cấp giới hạn 10 ảnh / 10 file Web SPCK và Màn 3.

**F01: CLOSED · F02: CLOSED · F03: CLOSED · F04: CLOSED.** Năm cổng bắt buộc đều **PASS**, probe độc lập **19/19 PASS** (0 FAIL), bao gồm **P09, P10, P11, P12, P13, P14**. Hai kiểm tra bổ sung tập trung vào nhánh đóng lỗi cũng **2/2 PASS**.

Kết luận gắn với bản làm việc có thay đổi chưa commit trên nền HEAD `9ed1d2b4d44fb31e4c1ed6730cc9244fb234b70a`, được khóa bằng danh mục SHA-256 trong bằng chứng Vòng 2. Không suy kết quả từ riêng mã HEAD hoặc từ kết quả S8 Round 4 trước đây.

Vòng 1 đạt 13/19 và NO-GO; báo cáo đó được giữ nguyên tại [bản lưu Vòng 1](web-spck-round2/CODEX_WEB_SPCK_AUDIT.round1.md). Vòng 2 không sửa mã sản phẩm, bộ kiểm thử gốc hoặc cấu hình gốc; chỉ xác minh bản sửa đã có và cập nhật tài liệu/bằng chứng.

## Phạm vi và cách cô lập

- Đọc `PROJECT_STATE.md` trước, đối chiếu `MINDX_AUTOMATION_PLAN.md`, `CHANGELOG.md`, `AGENTS.md`, ba tệp đã sửa và luồng quét/lưu nháp liên quan.
- Đồng bộ lại `archive-reader.ts`, `spck-scanner.ts`, `page.tsx` sang `%TEMP%\mindx-web-spck-audit-20261103-codex\snapshot`. Đối chiếu toàn bộ **124 tệp `src/**` và 23 tệp `scripts/**`**: bản gốc và bản sao khớp SHA-256, không thiếu/thừa tệp; đối chiếu lại sau kiểm thử.
- Cả TypeScript, bốn suite và probe đều chạy mới trên bản sao TEMP, với đủ bốn biến cô lập ở mỗi lệnh. Không sử dụng kết quả Vòng 1 để thay thế lượt chạy mới.
- Bản sao không có `.env`/`.env.local`, dữ liệu Owner hoặc hồ sơ đăng nhập thật; dùng liên kết `node_modules` đến thư viện đã cài. Không cài/cập nhật thư viện. Dữ liệu phát sinh nằm trong TEMP, khóa Gemini là khóa giả.
- Giữ nguyên bộ 19 ca `audit-probe.cts`: SHA-256 trước/sau **B653988EF121BF8EAA7B7DC4A4CEDA08CE72695E1DA71EAC206582F5EF018286**. Thư mục fixture cũ được đổi tên lưu lại trong TEMP để lượt mới không dùng lại ZIP/ảnh trước đó; không xóa dữ liệu thật.
- Probe gọi trực tiếp route bằng `Request` cục bộ; hàm giao diện `handleScanFolder` được trích từ mã thật và chạy trong môi trường giả lập. Bộ dựng thư mục GitHub được gọi trong bộ nhớ; không đẩy GitHub thật.

## Kết quả 5 cổng và bộ 19 ca

Tất cả chạy tại bản sao TEMP, ngày 03/11/2026, từ 11:44:16 đến khoảng 11:45:08 (Asia/Saigon).

| Lệnh | Kết quả | Thời gian | Bằng chứng |
|---|---|---|---|
| `npx --no-install tsc --noEmit --incremental false` | **PASS**, exit 0 | 1.63 giây | [tsc.log](web-spck-round2/tsc.log) |
| `npx --no-install tsx scripts/test-phase6.ts` | **PASS**, exit 0 | 9.37 giây | [test-phase6.log](web-spck-round2/test-phase6.log) |
| `npx --no-install tsx scripts/test-spck-v270.ts` | **PASS**, exit 0 | 6.31 giây | [test-spck-v270.log](web-spck-round2/test-spck-v270.log) |
| `npx --no-install tsx scripts/test-spck-v272.ts` | **PASS**, exit 0 | 20.65 giây | [test-spck-v272.log](web-spck-round2/test-spck-v272.log) |
| `npx --no-install tsx scripts/test-streamline-v340-s5.ts` | **PASS**, exit 0 | 7.82 giây | [test-streamline-v340-s5.log](web-spck-round2/test-streamline-v340-s5.log) |
| `npx --no-install tsx audit-probe.cts` | **PASS**, exit 0; **19/19** | 5.99 giây | [probe.log](web-spck-round2/probe.log) |

Lượt đầu trong sandbox hạn chế quyền có `spawn EPERM` khi mở công cụ biên dịch; probe lúc đó đạt 18/19 vì bộ chụp offline bị chặn. Đã lưu riêng lượt này tại `round2/restricted-attempt/` trong TEMP và chạy lại toàn bộ sáu lệnh bằng quyền thực thi phù hợp, giữ nguyên bốn biến cô lập. Bảng trên và kết luận GO chỉ dùng lượt chạy lại hoàn tất với exit 0. Các dòng chẩn đoán trên stderr được PowerShell ghi dạng `NativeCommandError` không thay thế mã thoát và kết quả kiểm thử trong JSON.

| Ca | Nội dung kiểm chứng | Round 2 |
|---|---|---|
| P01 | Ảnh nguyên liệu Web không chiếm ô ảnh LMS; ZIP giữ đủ 23 tệp nguồn hợp lệ, loại rỗng/null | PASS |
| P02 | Quét lại giữ một ZIP, không lồng ZIP và không đổi danh sách nguồn | PASS |
| P03 | Điểm vào HTML sâu 2–3 cấp; dựng thư mục GitHub giữ `.jfif`/`.text`, loại tài nguyên quản lý SPCK | PASS |
| P04 | Lớp có bài vượt giới hạn và bài hợp lệ: HTTP 200, có cảnh báo, chỉ lưu bài hợp lệ | PASS |
| P05 | Tất cả bài vượt giới hạn: HTTP 400, `success:false` | PASS |
| P06 | Nháp DRAFT nguyên bản buổi 12/13/14 nhận tài nguyên mới | PASS |
| P07 | WAITING_APPROVAL / APPROVED / VERIFIED có nhận xét giữ nguyên bản ghi theo buổi | PASS |
| P08 | Loại ảnh nguyên liệu cũ khỏi kho chung, giữ ảnh `_spck_app_shots` | PASS |
| **P09** | 12 tệp `.htm` hợp lệ tại gốc được đóng gói | **PASS — F01** |
| **P10** | HTML và 12 `.mjs` hợp lệ tại gốc được đóng gói | **PASS — F01** |
| **P11** | `modules/app.mjs` kích hoạt đóng gói mã trong thư mục con | **PASS — F01** |
| **P12** | Tệp `large.js` 5.242.884 byte không biến mất khỏi cả ZIP và đính kèm | **PASS — F02** |
| **P13** | HTML gốc chỉ chứa khoảng trắng bị loại khỏi đính kèm | **PASS — F04** |
| **P14** | Giao diện giữ đúng tệp theo buổi APPROVED, có `hasNewerSharedResources:true` | **PASS — F03** |
| P15 | Tệp JS có byte null không vào ZIP | PASS |
| P16 | Chụp offline thật với 24 ảnh, tổng 16.604.112 byte; đầu ra 960×540 | PASS |
| P17 | 13 tệp HTML/JS tại gốc gom đủ vào một ZIP hợp lệ | PASS |
| P18 | DRAFT đã có nhận xét hoặc ghi chú được giữ nguyên | PASS |
| P19 | DRAFT có `lastVerifiedAt` được bảo vệ | PASS |

Chi tiết từng ca và quan sát thực tế: [probe-results.json](web-spck-round2/probe-results.json), [probe.log](web-spck-round2/probe.log).

**Giới hạn cụ thể của P12:** fixture dùng chuỗi lặp khiến ZIP bị bộ bảo vệ tỷ lệ nén từ chối (1025:1). Tệp lớn được giữ làm đính kèm rời kèm cảnh báo; P12 không chứng minh tệp này nằm trong ZIP hợp lệ. Vì vậy đã kiểm tra bổ sung C01 để xác minh đúng nhánh tạo ZIP thành công và giữ các tệp chưa đóng gói, thay vì suy rộng kết quả P12.

## Đóng F01–F04

| ID | Mức độ Vòng 1 | Kết luận | Mã và bằng chứng đóng |
|---|---|---|---|
| **F01** | HIGH | **CLOSED** | `spck-scanner.ts:31,58` nhận `.htm`, `.mjs`, `.text`, `.md`, `.csv`, `.xml`; `archive-reader.ts:27` nhận đủ đuôi đọc nguồn. `walkWebProject` đánh dấu thư mục con cho toàn bộ `WEB_SOURCE_BUNDLE_EXTS`; điều kiện ZIP xét số đính kèm, số nguồn và thư mục con. P01/P09/P10/P11/P17 PASS; C02 đọc đủ 6 tệp mở rộng mới từ ZIP. |
| **F02** | HIGH | **CLOSED** | `spck-scanner.ts:1121` dùng ngưỡng `15 * 1024 * 1024`, khớp `ZIP_MAX_SINGLE_FILE_BYTES`; vượt ngưỡng có cảnh báo. `:1398–1405` chỉ loại đường dẫn thật nằm trong `bundledPathKeys`, giữ `unbundledAttachments`. P12 PASS; C01 chứng minh ZIP hợp lệ chứa tệp 6 MB và giữ riêng tệp 15 MB + 1 byte kèm cảnh báo. |
| **F03** | MEDIUM | **CLOSED** | `page.tsx:1413–1456` dựng ảnh, đính kèm, YouTube và liên kết theo `dbRec` khi có; chỉ dùng `pkg` khi chưa có bản ghi. P14: bộ đính kèm UI trùng bản APPROVED, cờ tài nguyên mới vẫn true; P06/P07/P18/P19 xác nhận route cập nhật DRAFT nguyên bản và giữ bản đã sửa/duyệt/có lịch sử. |
| **F04** | LOW | **CLOSED** | `spck-scanner.ts:567–581` từ chối null và văn bản chỉ có khoảng trắng cho mọi `TEXT_ATTACHMENT_EXTENSIONS`. P13/P15 PASS; C02 chạy 36 trường hợp rỗng/null trên đủ 18 đuôi, đều bị từ chối. |

Hai kiểm tra bổ sung **không thay thế hoặc sửa bộ 19 ca**:

- **C01 PASS:** `medium.js` **6.291.456 byte** vào ZIP hợp lệ cùng `CSS/style.css`, `index.html`; `over15.js` **15.728.641 byte** không vào ZIP, vẫn nằm trong đính kèm rời; có cảnh báo nêu tên tệp và giới hạn 15 MB. Danh sách đính kèm đúng hai mục: ZIP và `over15.js`.
- **C02 PASS:** 18 đuôi văn bản × 2 nội dung không hợp lệ = **36/36 bị từ chối**; sáu đuôi `.htm`, `.mjs`, `.text`, `.md`, `.csv`, `.xml` hợp lệ được nhận rời và đọc đủ trong ZIP.

Bằng chứng: [closure-focused-results.json](web-spck-round2/closure-focused-results.json), [bộ kiểm tra bổ sung](web-spck-round2/audit-closure-focused.cts).

## Bảo toàn dữ liệu thật và mã gốc

Chỉ đo dữ liệu thật bằng Node.js `fs.readFileSync` và SHA-256; không mở chúng bằng bộ lưu trữ ứng dụng.

| Tệp | SHA-256 trước = sau = Owner cung cấp | Kết quả |
|---|---|---|
| `data/mindx_bot.db` | `1483E2B9079B4A9D2E436AC4312907FED450F9A46F508930B1B785F332831802` | **UNCHANGED** |
| `data/running_classes.json` | `F03A852729D2D75470991BD4B8BAE2D86AB0EE0A68ABBF7801FB7417C125CBE9` | **UNCHANGED** |

- **147/147 tệp nguồn và bộ kiểm thử gốc giữ nguyên**, khớp bản sao trước/sau. Các tệp cấu hình ở gốc dự án trong danh mục ban đầu cũng giữ nguyên.
- Ba tài liệu quản lý chỉ đổi đoạn trạng thái đầu từ NO-GO Vòng 1 sang GO Vòng 2; báo cáo này được cập nhật và thêm thư mục bằng chứng. Giữ nguyên mọi thay đổi có sẵn của Owner; không reset, commit hoặc đẩy mã.
- Dấu vân tay ba tệp được đồng bộ và danh mục đầy đủ: [source-fingerprints.json](web-spck-round2/source-fingerprints.json), [preservation-final.json](web-spck-round2/preservation-final.json).

## Bằng chứng và chạy lại

Bằng chứng lưu cùng dự án tại [`docs/audits/v340/web-spck-round2/`](web-spck-round2/) gồm sáu log, kết quả cổng/probe, dấu vân tay, kết quả bảo toàn, hai bộ probe và báo cáo Vòng 1 nguyên bản. Bản sao và dữ liệu thử gốc vẫn nằm tại `%TEMP%\mindx-web-spck-audit-20261103-codex\`; bản lưu trước khi sửa bốn tài liệu nằm trong thư mục `round2` tại đó.

Mỗi lệnh kiểm thử đặt đủ bốn biến sau trong PowerShell tại bản sao `snapshot`:

```powershell
$env:ALLOWED_LOCAL_DIRS = $env:TEMP
$env:MINDX_DB_PATH = "$env:TEMP\mindx_codex_web_spck.db"
$env:MINDX_RUNNING_CLASSES_PATH = "$env:TEMP\mindx_codex_web_spck_rc.json"
$env:GEMINI_API_KEY = "test-web-spck-dummy-key"
```

Sau đó chạy các lệnh ở bảng cổng. Nếu chạy lại probe, giữ lại rồi đổi tên thư mục `snapshot\temp_submissions\independent-web-probe` trước để tránh tái sử dụng fixture cũ. Bộ probe có thao tác dọn bản ghi giả theo mã lớp cố định, chỉ được chạy với đường dẫn dữ liệu TEMP nêu trên.

## Chưa kiểm tra và bước tiếp theo

Chưa nộp LMS thật, chưa đẩy GitHub Pages/Drive thật, chưa gọi Gemini bằng khóa thật, chưa kiểm tra lớp/thư mục SPCK thật của Owner và chưa build production mới. Các nhánh tải lên/AI trong suite dùng giả lập; P16 là chụp Web offline thật. SHA-256 chỉ xác nhận hai tệp dữ liệu được yêu cầu, không thay thế việc đo mọi tệp phụ của dịch vụ đang chạy.

**Đủ điều kiện đóng F01–F04 trong phạm vi kiểm định cục bộ.** Việc tiếp theo là dùng thử trên lớp thật theo quy trình nghiệm thu riêng của Owner; GO này không xác nhận dịch vụ thật đã vận hành thành công.
