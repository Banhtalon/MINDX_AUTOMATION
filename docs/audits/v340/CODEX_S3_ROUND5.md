# Kiểm định độc lập v3.4.0 — Stage S3, Round 5

**Decision: GO cho Stage S3 Round 5 trong phạm vi mã và kiểm thử cô lập được yêu cầu.**

Ngày: **30/10/2026**. Baseline và HEAD: **`ab3f570e57c908bf5d19e3df10a563efc45616f6`**. Đối tượng: cây làm việc hiện tại, gồm mã/test S3 chưa được Git theo dõi; fingerprint tại mục 6. Codex thực hiện trực tiếp vai trò auditor Owner yêu cầu, không gán kết quả cho reviewer/model khác.

**S3-08 CLOSED; toàn bộ S3-01..S3-08 CLOSED.** Hai nhánh VM R4-M02 và Chromium N05 không còn ghi đè note của tab khác: retry giữ `fbase=teacherNote:0`, nhận xung đột stale, giữ bản cục bộ và chặn approve/save-lms. **15/15 gate chạy mới đều exit 0 ngay lượt đầu.** P01..P22 đạt **23/23**, Q01..Q11 đạt **54/54**; R3-M01, N01..N05 và các control bổ sung đều PASS. Không phát hiện finding mới trong phạm vi kiểm định này.

Hai tệp production giữ nguyên SHA-256 và khớp giá trị kỳ vọng. **2.300/2.300 tệp có sẵn giữ hash, kích thước và thời gian ghi.** Chỉ tạo báo cáo này trong repository; không sửa mã ứng dụng, test, cấu hình hoặc hồ sơ audit cũ. GO này không thay thế nghiệm thu dịch vụ thật hoặc toàn bộ v3.4.0.

## 1. Phạm vi, phương pháp và cách ly

- Đọc `PROJECT_STATE.md` đầu tiên; đối chiếu Giai đoạn 10/S3 trong `MINDX_AUTOMATION_PLAN.md`, `CHANGELOG.md`, `AGENTS.md` và hồ sơ S3 trước, đặc biệt Round 4. Tiếp tục áp dụng `ponytail-audit` và `verify-and-stop`: xác minh đúng yêu cầu, không triển khai sửa sản phẩm.
- Đọc hai tệp vừa sửa: `src/app/session-comments/page.tsx` và `scripts/test-streamline-v340-s3.ts`; lần theo save-draft/list/approve/save-lms, SQLite và hàng đợi. Hash route save-draft và các module approve/Zalo giống Round 4; hai tệp vừa sửa có fingerprint mới.
- Workspace thử: `C:\Users\QQ\AppData\Local\Temp\mindx-s3-r5-audit-20261030\workspace`. Sao chép mã/test, `data/config`, skills và các tệp phục vụ test, gồm `AGENTS.md`, `GEMINI.md`, `PROJECT_STATE.md`, hai script khởi động. **Không sao chép DB/cache lớp thật, `.env*` hoặc `playwright-auth`; không chạy script khởi động.**
- Mỗi tiến trình test/probe có `ALLOWED_LOCAL_DIRS`, `MINDX_DB_PATH`, `MINDX_RUNNING_CLASSES_PATH` trỏ vào thư mục riêng trong TEMP. `TEMP`/`TMP` của tiến trình con cũng thuộc vùng audit. Quick Tags được cấp đủ override từ ngoài; suite tự đổi DB tương đối vẫn chỉ chạy trong workspace TEMP.
- Chạy TypeScript bằng đường SWC được Owner cho phép từ Round 3: `@next/swc-win32-x64-msvc`, `require.extensions['.ts' / '.tsx']`, phân giải alias về mirror và package về thư viện đã cài. Wrapper esbuild chỉ thêm `nodePaths` cho `build`/`buildSync`. Không sửa suite/assertions, cài thư viện hoặc tạo junction `node_modules`.
- Chặn TCP ra ngoài trước khi nạp test; Chromium dùng proxy loopback không hoạt động, các trang/API giả do Playwright cung cấp. Dùng `GEMINI_API_KEY=audit-synthetic-offline-key`; không dùng khóa thật. Loader từ chối đọc/mở/ghi/sao chép hai đường dẫn dữ liệu production. Không gọi nghiệp vụ LMS/Teaching/Gemini thật hoặc gửi Zalo.
- P01..P22 chạy bản sao nguyên tệp `docs/audits/v340/s3-round1/adversarial.cjs`. Các probe Q/N/M không được giữ thành tệp sau dọn TEMP vòng trước, nên dựng lại từ tình huống và bằng chứng đã ghi; không tuyên bố có bản mã Q/N/M gốc để so sánh từng byte. R4-M02 được chạy thành **hai nhánh VM riêng**, không chỉ dựa vào test mới kết hợp cả hai nhánh trong section 6.
- VM chạy handler component thật, route thật và SQLite TEMP thật; hooks/độ trễ/lỗi mạng được điều khiển. Q01 nối **save-lms thật → `taskQueue.enqueue` thật → mock `CommentSaver.saveComments`** tại ranh giới LMS.
- Native dùng **Chromium, React và JSX trang thật**, bundle trong TEMP và chỉ chèn điểm quan sát ngoài `src/**`. Các API lưu/duyệt/list/save-lms gọi handler thật với DB TEMP. N05 dùng nhập textarea, blur bằng Tab và bấm nút **Duyệt & Lưu riêng** thật; cập nhật của phiên khác đi qua route thật, không sửa SQLite trực tiếp để tạo xung đột.
- Giữ nguyên ba tài liệu trạng thái/kế hoạch/changelog theo yêu cầu chỉ ghi báo cáo. Không dùng tác vụ tương tác stdin bị cấm; không yêu cầu Owner thao tác kỹ thuật.

## 2. Gate Execution Summary

Lệnh thực thi thực tế:

```text
CHECKOUT = F:\MINDX_project test\MINDX-AUTOMATION
TEMP     = C:\Users\QQ\AppData\Local\Temp\mindx-s3-r5-audit-20261030
SWC      = node <TEMP>\loader.cjs scripts\<suite>.ts
           cwd = <TEMP>\workspace; đủ ba override dữ liệu TEMP
TSC      = node <CHECKOUT>\node_modules\typescript\bin\tsc --noEmit --incremental false
           cwd = CHECKOUT; đủ ba override dữ liệu TEMP
```

Các đối số, bao gồm đường dẫn có khoảng trắng, được truyền riêng bằng Node `spawnSync`. Bảng dùng **exit của từng tiến trình**, không dùng exit của chương trình điều phối thay thế. SWC chạy nguyên suite theo đường thực thi đã được cho phép; không khẳng định đã chạy qua `npx` khi thực tế dùng Node/SWC.

### 15 gate bắt buộc — chạy mới, không cần retry

| # | Lệnh yêu cầu | Thực thi | Exit | Kết quả |
|---:|---|---|---:|---|
| 1 | `npx tsc --noEmit --incremental false` | TSC | **0** | PASS; không ghi build tăng dần. |
| 2 | `npx tsx scripts/test-streamline-v340-s3.ts` | SWC | **0** | Đủ các phần, gồm section 6/S3-08b. |
| 3 | `npx tsx scripts/test-quick-tags-v300.ts` | SWC | **0** | PASS trên DB TEMP. |
| 4 | `npx tsx scripts/test-streamline-v340-s1.ts` | SWC | **0** | PASS. |
| 5 | `npx tsx scripts/test-streamline-v340-s2.ts` | SWC | **0** | PASS. |
| 6 | `npx tsx scripts/test-phase5.ts` | SWC | **0** | PASS. |
| 7 | `npx tsx scripts/test-phase6.ts` | SWC | **0** | PASS, gồm Chromium. |
| 8 | `npx tsx scripts/test-phase7.ts` | SWC | **0** | PASS; chỉ ghi cấu hình thử trong mirror. |
| 9 | `npx tsx scripts/test-phase4-codex-repros.ts` | SWC | **0** | PASS. |
| 10 | `npx tsx scripts/test-spck-v270.ts` | SWC | **0** | PASS. |
| 11 | `npx tsx scripts/test-spck-v272.ts` | SWC | **0** | PASS. |
| 12 | `npx tsx scripts/test-lms-reliability-v280.ts` | SWC | **0** | PASS. |
| 13 | `npx tsx scripts/test-session14-v290.ts` | SWC | **0** | PASS. |
| 14 | `npx tsx scripts/test-teaching-project-v320.ts` | SWC | **0** | PASS. |
| 15 | `npx tsx scripts/test-report-card-v330.ts` | SWC | **0** | PASS. |

Không có lượt thất bại/retry của 15 gate hoặc các probe nghiệm thu trong Round 5. Các lỗi HTTP/network được chủ động bơm vào là dữ kiện kiểm thử, không phải lỗi chạy suite. Không chạy build/dev server ngoài yêu cầu.

### Probe độc lập và bảo toàn dữ liệu

| Lệnh thực thi | Exit | Kết quả |
|---|---:|---|
| `node <TEMP>\loader.cjs <TEMP>\adversarial.cjs` | **0** | P01..P22: **23 PASS / 0 FAIL**, P15 có hai trạng thái. |
| `node <TEMP>\loader.cjs <TEMP>\q.cjs` | **0** | **56 PASS / 0 FAIL** = Q01..Q11 **54/54** + hai control network/stale toàn request. |
| `node <TEMP>\loader.cjs <TEMP>\closure.cjs` | **0** | **11 PASS / 0 FAIL**, gồm R3-M01, hai nhánh R4-M02 và các control bảo toàn/giải quyết xung đột. |
| `node <TEMP>\loader.cjs <TEMP>\native.cjs` | **0** | **8 PASS / 0 FAIL**, gồm N01..N05, hai nhánh N02 và hai control bổ sung của N04. |
| `node <TEMP>\preservation.cjs` | **0** | **2.300/2.300** tệp có sẵn giữ hash/kích thước/thời gian ghi. |
| `Get-FileHash -Algorithm SHA256 -LiteralPath 'data/mindx_bot.db', 'data/running_classes.json'` trước/sau | **0; 0** | Hai hash khớp giá trị kỳ vọng. |
| `node -e "...fs.rmSync(target,{recursive:true,force:true})..."` | **0** | Target được kiểm tra thuộc Windows TEMP, không phải liên kết; sau xóa `auditTempDeleted:true`. |

Các con số là quan sát/assertion của từng bộ, có kiểm tra chồng lặp cùng luồng; không diễn giải thành số tình huống sản phẩm độc nhất. Các lệnh điều tra/chuẩn bị không được tính thành gate nghiệm thu.

## 3. Finding Table

| ID | Severity gốc | Status | Vị trí hiện tại | Bằng chứng đóng/giữ đóng |
|---|---|---|---|---|
| S3-01 | HIGH | **CLOSED** | `src/app/session-comments/page.tsx:390`, `:1252`, `:1849` | P03..P06; Q03/Q11, network/stale controls và N01: đợi đủ các lần lưu, chặn hành động khi lỗi, giữ bản cục bộ qua reload và retry. |
| S3-02 | HIGH | **CLOSED** | `src/app/session-comments/page.tsx:2855`, `:2966`, `:3347` | P17, Q02 **4/4**, N02 **2/2**: sửa trong lúc duyệt chặn đẩy; thông báo đúng khi phục hồi thành công/thất bại. |
| S3-03 | HIGH | **CLOSED** | `src/app/session-comments/page.tsx:1416` | P07/P08, Q09, N03: dispatch đủ ba hàng keepalive và dialog beforeunload thật, chọn ở lại. |
| S3-04 | MEDIUM | **CLOSED** | `src/app/api/session-comments/save-draft/route.ts:203`, `:504` | P10; Q05 **28/28**, Q06 save: validation/ngoại lệ từng hàng không che giấu phần đã ghi, vẫn xử lý hàng hợp lệ phía sau. |
| S3-05 | MEDIUM | **CLOSED** | `src/app/api/session-comments/approve/route.ts:101`, `:328` | P15; Q07 **6/6**, Q08 **4/4**, Q06 approve: guard trạng thái DB và kiểu nội dung, đủ kết quả batch. |
| S3-06 | LOW | **CLOSED** | `src/lib/zalo/broadcast-generator.ts:167`, `:171`, `:187` | P16, Q10 **4/4**: giữ mẫu chuẩn đã tùy chỉnh và điều kiện Phần 2 khi có ảnh. |
| S3-07 | HIGH | **CLOSED** | `src/app/session-comments/page.tsx:3292`; `scripts/test-streamline-v340-s3.ts:422` | Q01 **2/2**, S3 suite, N01: payload hai nút có đúng classCode, qua route và hàng đợi thật. |
| **S3-08** | **HIGH** | **CLOSED** | `src/app/session-comments/page.tsx:393`, `:735`, `:1448`, `:1836`, `:1849`, `:1992`, `:2058`, `:2111`, `:2145`; `scripts/test-streamline-v340-s3.ts:980` | R3-M01/N04 tiếp tục PASS; R4-M02 **2/2** và N05 PASS: giữ base 0 khi note đang lưu, retry phát hiện stale, không ghi đè tab khác, không gọi approve/save-lms. Các control giải quyết chủ động vẫn PASS. |

Không còn finding OPEN trong S3-01..S3-08. Không phát hiện finding mới trong phạm vi mã và tình huống đã kiểm định.

## 4. Bằng chứng đóng hoàn toàn S3-08 trong phạm vi repro đã ghi nhận

### Đối chiếu mã sửa

- `studentUnconfirmedBaseVerRef` giữ mốc từng trường từ lúc bắt đầu chỉnh sửa. Cả schedule và save chỉ khởi tạo base khi chưa có, request dùng mốc này để tạo `fbaseEntries`.
- Cả ba điểm gộp metadata đã tính các trường có edit version cao hơn confirmed version, cùng phần đang debounce/chưa lưu. Không còn phụ thuộc việc `prevMeta.fields` đã có dữ liệu mới bảo vệ được base 0.
- Thành công chỉ xóa mốc khi không còn bản sửa mới hơn của cùng trường; stale chuyển sang cơ chế khóa xung đột. Phần HTTP/network error tiếp tục giữ mốc để retry không tự nhận phiên bản của tab khác.
- Route save-draft giữ hợp đồng acceptedFields/staleFields/partialStale từ Round 4. Client tiếp tục chỉ xác nhận trường được nhận, giữ trường stale và chặn hành động phụ thuộc.

### R4-M02 — Hai nhánh VM chạy riêng

Thứ tự giữ nguyên: A gửi teacherNote và đang chờ → tab khác ghi note version 1 → nhánh B thành công ở trường khác **hoặc** preserving reload → A trả HTTP 500 → bấm handler duyệt/lưu riêng để retry.

| Quan sát | Phản hồi trường khác | Preserving reload |
|---|---|---|
| Metadata base note trước khi A lỗi | **0** | **0** |
| Base được giữ riêng khi A đang chờ | **0** | **0** |
| `fbase` request retry | **`teacherNote:0`** | **`teacherNote:0`** |
| Note trong DB sau retry | **`REMOTE NOTE MUST SURVIVE`** | **`REMOTE NOTE MUST SURVIVE`** |
| Note cục bộ được giữ | **`INFLIGHT LOCAL NOTE`** | **`INFLIGHT LOCAL NOTE`** |
| Lý do chưa lưu | **`stale`** | **`stale`** |
| Request approve/save-lms sau retry | **0** | **0** |

Ở Round 4, hai nhánh này nâng base thành 1, retry=true và ghi đè note tab kia. Round 5 giữ base 0 và phát hiện xung đột đúng như kỳ vọng. Harness không tự sửa `fbase` hoặc metadata để làm test đạt.

### N05 — Chromium thật

Nhập note vào textarea → chuyển sang ô nhận xét để blur/gửi A → giữ A → phiên khác cập nhật note qua route thật → nhập/blur finalText, cho B thành công → A trả HTTP 500 → bấm **Duyệt & Lưu riêng**. Các giá trị quan sát:

```json
{
  "baseBefore": 0,
  "pin": 0,
  "fbase": "teacherNote:0",
  "flushed": false,
  "dbNote": "REMOTE NATIVE NOTE MUST SURVIVE",
  "localUnsavedNote": "INFLIGHT NATIVE LOCAL NOTE",
  "fieldReason": "stale",
  "approveAndSaveLmsRequests": 0,
  "pageErrors": []
}
```

Chromium không còn đi tiếp tới approve/save-lms như N05 Round 4. Kết quả dùng route và SQLite TEMP thật; không suy từ một chuỗi xuất hiện trong mã nguồn.

### Các control tránh sửa một lỗi rồi làm hỏng luồng khác

- R3-M01/N04: request gộp có note stale nhưng finalText hợp lệ vẫn lưu finalText, giữ note tab khác, giữ bản cục bộ qua reload và trả false.
- Sửa finalText thêm hai lần vẫn giữ khóa stale của teacherNote; chiều ngược, sửa note không giải phóng khóa finalText. AI, duyệt riêng/cả lớp và duyệt/đẩy không chạy khi còn xung đột.
- Giáo viên chủ động sửa lại chính trường bị xung đột thì lưu thành công, hết vùng unsaved; xác nhận ở VM và native N04.
- Các nhánh lỗi HTTP/network khi hai trường hoàn thành ngược thứ tự, staleIgnored toàn request, base sau lỗi đã ghi nhận, và đường thuận lưu/duyệt/đẩy đều tiếp tục đạt.

## 5. Đối chiếu sáu quy tắc dự án và giới hạn

- **Nguồn trạng thái:** đã đối chiếu hồ sơ và bản sửa, kết luận chỉ gắn với fingerprint hiện tại. Theo yêu cầu Owner, không sửa checklist/kế hoạch/changelog hoặc hồ sơ lịch sử.
- **Chạy nội bộ, bí mật, Allowlist:** không thay cấu hình bind hoặc mở Student Portal/tunnel. Engine Zalo chung và ranh giới client/server không đổi so với Round 4. Mọi tiến trình kiểm thử có đủ override dữ liệu TEMP; không dùng credentials thật.
- **Playwright, checkpoint, xác minh sau ghi:** route save-lms giữ hàng đợi thật; không đổi browser manager hoặc mã checkpoint/xác minh sau ghi. Hồi quy Chromium chạy được. Các browser test dùng dữ liệu giả và đóng context sau từng case, không dùng Persistent Context Owner để đăng nhập.
- **Toàn vẹn/hash:** P11..P14 tiếp tục đạt; S3-08 bổ sung bằng chứng giữ mốc cho bản chưa được xác nhận, trước bước băm/duyệt.
- **AI/Zalo/SPCK:** các suite guardrails/hồi quy chạy offline; mẫu tùy chỉnh, ngày kế tiếp và điều kiện Phần 2 tiếp tục đạt. Không thay quy tắc logo mặc định.
- **Vai trò/giao tiếp:** Codex audit trực tiếp theo chỉ định, không giả nhận một lượt review của Claude/Opus và không yêu cầu Owner thực hiện lệnh.

**Chưa kiểm tra:** LMS/Teaching/Gemini/Zalo thật; Next production build/dev server; đóng cưỡng bức/mất điện hoặc bảo đảm mọi keepalive được nhận nếu chọn rời trang. N03 xác nhận dialog thật và chọn ở lại. Native dùng JSX/React thật qua transport kiểm thử, chưa phải nghiệm thu toàn bộ hệ thống đang chạy thật. Không nghiệm thu S4..S8/toàn bộ v3.4.0.

## 6. Production Data Preservation Check và fingerprint

Lệnh duy nhất đọc nội dung hai tệp production theo ngoại lệ Owner cho phép:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath 'data/mindx_bot.db', 'data/running_classes.json'
```

| Tệp | SHA-256 trước | SHA-256 sau | Kết quả |
|---|---|---|---|
| `data/mindx_bot.db` | `28574C5708D04162B18D65746EC8788C456274E206542255206CE5084E446ED7` | `28574C5708D04162B18D65746EC8788C456274E206542255206CE5084E446ED7` | **UNCHANGED — MATCH** |
| `data/running_classes.json` | `ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2` | `ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2` | **UNCHANGED — MATCH** |

Không mở SQLite, sao chép, sửa hoặc xóa hai tệp production. Đối chiếu **2.300 tệp có sẵn** trong `src`, `scripts`, `docs`, `data/config`, `.agents` và các tệp gốc: không đổi hash, kích thước hoặc thời gian ghi. Phép đo gồm tệp chưa commit, hồ sơ Round 1..4 và audit lịch sử; không chỉ dựa vào Git diff.

| Tệp | SHA-256 trước/sau giống nhau |
|---|---|
| `src/app/session-comments/page.tsx` | `9619fc285124d4de905a004238368cf62d23b0c94f1177415adbae72aea68b71` |
| `scripts/test-streamline-v340-s3.ts` | `37931e125544ec284140c1ce45a8e246e9db56b96da436726c358b7f226c5ff9` |
| `src/app/api/session-comments/save-draft/route.ts` | `94fb00b6773c45a6c0a56cec72d3847d127eb732f062773d5dc5c208196936ae` |
| `src/app/api/session-comments/approve/route.ts` | `456eb64636add416ac0f89390e059bebfdb6e79b4caacf23912f3cc23f9fd65f` |
| `src/lib/zalo/zalo-summary.ts` | `c260c785bc89aecdd7b4682b060eafe63aa21cc19ec1c9ac3bad2e5df6ad373c` |
| `src/lib/zalo/broadcast-generator.ts` | `57ac4e5e6dcea7f5dfdc683ccc260a017dade8a06d1a3c7b228ac06fe9c474b4` |
| `src/app/api/session-comments/zalo-btvn-image/route.ts` | `a0999ba3bfd2c0572c1b5d4436b0c8405c7f6786b9c17d203db86b39de26bb0c` |
| Probe P gốc và bản sao đã chạy | `56d820c15020797635c437a310891fcc07480dc26f947ab036e6ac06d26257cf` |

Scratch/log/DB giả chỉ nằm trong TEMP; bằng chứng quyết định đã tổng hợp trong báo cáo này. **Đã dọn toàn bộ thư mục audit bằng Node `fs.rmSync(target, {recursive:true, force:true})`, exit 0; sau xóa `auditTempDeleted:true`.** Trước xóa đã kiểm tra đường dẫn nằm trong Windows TEMP và không phải liên kết. Không dùng PowerShell xóa đệ quy hoặc tạo thêm thư mục bằng chứng trong checkout. Phép đối chiếu cuối xác nhận báo cáo này là tệp mới duy nhất trong các vùng được theo dõi, không có tệp có sẵn nào bị đổi/mất.

## 7. Kết quả và việc tiếp theo

**Đã làm:** kiểm định độc lập Round 5, chạy đủ 15 gate và toàn bộ probe yêu cầu, không sửa sản phẩm. **Kết quả:** GO cho S3 tại fingerprint nêu trên; cả 8 finding CLOSED. **Chưa kiểm tra:** các dịch vụ thật và giới hạn ở mục 5. **Việc tiếp theo:** có thể dùng báo cáo này để chốt S3 và chuẩn bị S4; cập nhật các tài liệu theo dõi hoặc triển khai chặng tiếp theo thuộc lượt công việc khác.
