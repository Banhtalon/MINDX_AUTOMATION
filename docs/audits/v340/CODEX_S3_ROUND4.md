# Kiểm định độc lập v3.4.0 — Stage S3, Round 4

**Decision: NO-GO cho Stage S3 Round 4.**

Ngày: **30/10/2026**. Baseline và HEAD: **`ab3f570e57c908bf5d19e3df10a563efc45616f6`**. Đối tượng: cây làm việc hiện tại, gồm mã/test S3 chưa được Git theo dõi. Codex thực hiện trực tiếp vai trò auditor Owner yêu cầu; không gán kết quả cho Claude hoặc một reviewer khác.

**15/15 gate chạy mới đạt ngay lượt đầu, tất cả exit 0. P01..P22 đạt 23/23; Q01..Q11 đạt 54/54; các control Chromium N01..N03 và repro gốc N04 đều đạt. Repro VM R3-M01 đã hết lỗi. Tuy nhiên, S3-08 mới được sửa một phần và vẫn OPEN/HIGH:** khi một lần lưu đang chờ phản hồi, phản hồi của trường khác hoặc một lần tải lại có thể nâng nhầm mốc phiên bản của trường chưa lưu. Lần thử lại sau đó ghi đè ghi chú mới của tab khác, bỏ qua cảnh báo xung đột. Tái hiện mới: **R4-M02 hai nhánh VM và N05 trên Chromium thật — ba FAIL cùng một nguyên nhân**.

Hai tệp production khớp SHA-256 kỳ vọng trước/sau. **2.298/2.298 tệp có sẵn giữ nguyên SHA-256, kích thước và thời gian ghi.** Chỉ tạo báo cáo này trong repository; không sửa ứng dụng, test, cấu hình hoặc hồ sơ audit cũ.

## 1. Phạm vi và cách ly

- Đọc `PROJECT_STATE.md` đầu tiên, đối chiếu Giai đoạn 10/S3 trong `MINDX_AUTOMATION_PLAN.md`, `CHANGELOG.md`, `AGENTS.md` và kết quả ba vòng trước. S3 vẫn chờ nghiệm thu trong kế hoạch. Áp dụng tiếp phương pháp `ponytail-audit` và `verify-and-stop`, chỉ xác minh trong phạm vi S3.
- Đọc ba tệp vừa sửa: `save-draft/route.ts`, `session-comments/page.tsx`, `test-streamline-v340-s3.ts`; lần theo các bên nhận/gọi liên quan: list, approve, save-lms, SQLite, hàng đợi và Zalo. Đối chiếu fingerprint Round 3: các module approve/Zalo không thay đổi; ba tệp sửa S3-08 có fingerprint mới tại mục 6.
- Workspace thử: `C:\Users\QQ\AppData\Local\Temp\mindx-s3-r4-audit-20261030\workspace`. Chỉ sao chép mã/test, `data/config`, skills và các tệp phục vụ test, gồm `AGENTS.md`, `GEMINI.md`, `PROJECT_STATE.md`, hai script khởi động. **Không sao chép DB/cache lớp thật, `.env*` hoặc `playwright-auth`; không chạy script khởi động.**
- Trước **mỗi** tiến trình, đặt `ALLOWED_LOCAL_DIRS`, `MINDX_DB_PATH`, `MINDX_RUNNING_CLASSES_PATH` vào thư mục riêng dưới TEMP. `TEMP`/`TMP` của tiến trình con cũng nằm trong vùng audit. Quick Tags có đủ override bên ngoài; các suite tự đổi DB tương đối vẫn chỉ chạy trong workspace TEMP.
- Dùng loader SWC theo đường thực thi đã được Owner cho phép ở Round 3: `@next/swc-win32-x64-msvc`, `require.extensions['.ts' / '.tsx']`, phân giải `@/` về mirror và package về thư viện đã cài. Wrapper esbuild chỉ thêm `nodePaths` cho `build`/`buildSync`. Không sửa suite/assertions, cài thư viện hoặc tạo junction `node_modules`.
- Chặn TCP ra ngoài trước khi nạp test; Chromium dùng proxy loopback không hoạt động. Dùng khóa giả `audit-synthetic-offline-key`; không có tệp `.env` thật trong mirror. Loader từ chối đọc/mở/ghi/sao chép hai đường dẫn production. Không gửi request nghiệp vụ LMS/Teaching/Gemini thật hoặc tin Zalo.
- P01..P22 chạy từ bản sao nguyên tệp `docs/audits/v340/s3-round1/adversarial.cjs`. Các probe Q/N/R3-M01 không được lưu thành tệp sau khi dọn TEMP Round 3, nên dựng lại từ tình huống và bằng chứng đã ghi trong báo cáo; không tuyên bố có bản mã gốc Q/N để so sánh từng byte.
- VM dùng handler component thật, các route thật và SQLite TEMP thật; hooks/độ trễ/lỗi mạng được điều khiển. Q01 nối **route save-lms thật → `taskQueue.enqueue` thật → mock `CommentSaver.saveComments`**. Không thay route hoặc hàng đợi bằng thành công giả.
- Native dùng **Chromium, React và JSX trang thật** được bundle trong TEMP, chỉ chèn điểm quan sát vào bản sao ngoài `src/**`. Playwright cung cấp trang/API qua transport giả, các handler API lưu/duyệt/list/save-lms vẫn chạy thật trên SQLite TEMP. Đây là bằng chứng hành vi trình duyệt, chưa phải chạy Next server hay nghiệm thu LMS thật.
- Chỉ tạo `CODEX_S3_ROUND4.md`, giữ nguyên ba tài liệu theo dõi theo yêu cầu cụ thể của lượt này. Không dùng tác vụ tương tác stdin bị cấm; không gọi reviewer/model khác rồi tự gán kết quả cho họ.

## 2. Gate Execution Summary

Ký hiệu thực thi thực tế:

```text
CHECKOUT = F:\MINDX_project test\MINDX-AUTOMATION
TEMP     = C:\Users\QQ\AppData\Local\Temp\mindx-s3-r4-audit-20261030
SWC      = node <TEMP>\loader.cjs scripts\<suite>.ts
           cwd = <TEMP>\workspace; đủ ba override dữ liệu TEMP
TSC      = node <CHECKOUT>\node_modules\typescript\bin\tsc --noEmit --incremental false
           cwd = CHECKOUT; đủ ba override dữ liệu TEMP
```

Node `spawnSync` truyền đối số riêng, bao gồm các đường dẫn có khoảng trắng. Bảng dùng **exit của từng tiến trình**, không dùng exit của chương trình điều phối thay thế. SWC chạy nguyên các suite được yêu cầu; không trình bày những lệnh chưa chạy bằng `npx` như thể đã chạy qua `npx`.

### 15 gate bắt buộc — tất cả chạy mới

| # | Lệnh yêu cầu | Thực thi | Exit | Kết quả |
|---:|---|---|---:|---|
| 1 | `npx tsc --noEmit --incremental false` | TSC | **0** | PASS; không ghi build tăng dần. |
| 2 | `npx tsx scripts/test-streamline-v340-s3.ts` | SWC | **0** | Đủ các phần, gồm section 6/S3-08. |
| 3 | `npx tsx scripts/test-quick-tags-v300.ts` | SWC | **0** | PASS trên DB TEMP. |
| 4 | `npx tsx scripts/test-streamline-v340-s1.ts` | SWC | **0** | PASS. |
| 5 | `npx tsx scripts/test-streamline-v340-s2.ts` | SWC | **0** | PASS. |
| 6 | `npx tsx scripts/test-phase5.ts` | SWC | **0** | PASS. |
| 7 | `npx tsx scripts/test-phase6.ts` | SWC | **0** | PASS, gồm Chromium. |
| 8 | `npx tsx scripts/test-phase7.ts` | SWC | **0** | PASS; cấu hình thử chỉ ghi trong mirror. |
| 9 | `npx tsx scripts/test-phase4-codex-repros.ts` | SWC | **0** | PASS. |
| 10 | `npx tsx scripts/test-spck-v270.ts` | SWC | **0** | PASS. |
| 11 | `npx tsx scripts/test-spck-v272.ts` | SWC | **0** | PASS. |
| 12 | `npx tsx scripts/test-lms-reliability-v280.ts` | SWC | **0** | PASS. |
| 13 | `npx tsx scripts/test-session14-v290.ts` | SWC | **0** | PASS. |
| 14 | `npx tsx scripts/test-teaching-project-v320.ts` | SWC | **0** | Đủ TP-01..TP-06. |
| 15 | `npx tsx scripts/test-report-card-v330.ts` | SWC | **0** | PASS. |

Không có lượt lỗi thiết lập/retry đối với 15 gate này. Không còn lỗi `spawn EPERM` hoặc thiếu thư viện mirror. Không chạy build/dev server ngoài yêu cầu.

### Probe độc lập và mã thoát

| Lệnh thực thi | Exit | Kết quả |
|---|---:|---|
| `node <TEMP>\loader.cjs <TEMP>\adversarial.cjs` | **0** | P01..P22: **23 PASS / 0 FAIL**; P15 chạy hai trạng thái. |
| `node <TEMP>\loader.cjs <TEMP>\q.cjs` | **0** | **56 PASS / 0 FAIL** = Q01..Q11 **54/54** + hai control network/stale toàn request. |
| `node <TEMP>\loader.cjs <TEMP>\closure.cjs` | **0** | **9 PASS / 0 FAIL**: R3-M01, khóa xung đột, chặn hành động, giải quyết chủ động, hai control giữ base sau khi lỗi đã được ghi nhận. |
| `node <TEMP>\loader.cjs <TEMP>\native.cjs` | **0** | **7 PASS / 0 FAIL**: N01, hai nhánh N02, N03, N04, sửa trường khác vẫn giữ khóa, chủ động sửa note để giải quyết. |
| `node <TEMP>\loader.cjs <TEMP>\boundary.cjs` | **1** | **0 PASS / 2 FAIL**: R4-M02, phản hồi trường khác và preserving reload khi note vẫn đang lưu. |
| `node <TEMP>\loader.cjs <TEMP>\native-boundary.cjs` | **1** | **0 PASS / 1 FAIL**: N05, nhập/blur thật, retry ghi đè note của tab khác và vẫn phát save-lms. |
| `node <TEMP>\preservation.cjs` | **0** | **2.298/2.298** tệp có sẵn giữ hash/kích thước/thời gian ghi. |
| `Get-FileHash -Algorithm SHA256 -LiteralPath 'data/mindx_bot.db', 'data/running_classes.json'` trước/sau | **0; 0** | Khớp cả hai giá trị kỳ vọng. |
| `node -e "...fs.rmSync(target,{recursive:true,force:true})..."` | **0** | Target được kiểm tra thuộc Windows TEMP, không phải liên kết; sau xóa `auditTempDeleted:true`. |

Ba FAIL mới đều là kiểm tra hành vi đã chạy tới kết quả, không phải lỗi harness/môi trường. Chúng cùng thuộc phần bảo toàn base còn thiếu của **S3-08**, không tạo ba finding trùng lặp. Các phép đo lặp lại cùng luồng không được coi là số tình huống sản phẩm độc nhất.

## 3. Finding Table

| ID | Severity | Status | Vị trí hiện tại | Bằng chứng Round 4 |
|---|---|---|---|---|
| S3-01 | HIGH | **CLOSED** | `src/app/session-comments/page.tsx:390`, `:1249`, `:1847` | P03..P06; Q03/Q11 và network/stale controls; N01. Lỗi lưu chéo trường được đợi đủ, giữ bản lỗi, reload/retry đúng. |
| S3-02 | HIGH | **CLOSED** | `src/app/session-comments/page.tsx:2826`, `:2937`, `:3318` | P17, Q02 **4/4**, N02 **2/2**: sửa trong lúc duyệt chặn đẩy; phục hồi thành công/thất bại được báo đúng. |
| S3-03 | HIGH | **CLOSED** | `src/app/session-comments/page.tsx:1413`, `:1909` | P07/P08, Q09, N03: đủ ba request keepalive và dialog `beforeunload` thật, chọn ở lại. Không chứng nhận lưu thành công khi đóng cưỡng bức/chọn rời trang. |
| S3-04 | MEDIUM | **CLOSED** | `src/app/api/session-comments/save-draft/route.ts:203`, `:504` | P10, Q05 **28/28**, Q06 save: dữ liệu sai kiểu/ngoại lệ ở hàng giữa vẫn có đủ kết quả, bảo toàn các hàng hợp lệ. |
| S3-05 | MEDIUM | **CLOSED** | `src/app/api/session-comments/approve/route.ts:101`, `:328` | P15, Q07 **6/6**, Q08 **4/4**, Q06 approve: không vượt guard DB bằng bỏ/giả status; batch trả kết quả từng hàng. |
| S3-06 | LOW | **CLOSED** | `src/lib/zalo/broadcast-generator.ts:167`, `:171`, `:187` | P16, Q10 **4/4**: giữ mẫu chuẩn đã tùy chỉnh, đúng điều kiện Phần 2 khi có ảnh. |
| S3-07 | HIGH | **CLOSED** | `src/app/session-comments/page.tsx:3263`; `scripts/test-streamline-v340-s3.ts:422` | Q01 **2/2**, S3 suite và N01: cả lớp/từng dòng có classCode, qua route và hàng đợi thật tới mock LMS. |
| **S3-08** | **HIGH** | **OPEN — đã sửa một phần** | `src/app/session-comments/page.tsx:732`, `:761`, `:1958`, `:1965`, `:1966`, `:1831`, `:2105` | R3-M01/N04 đã PASS, accepted/stale fields có tác dụng. Nhưng R4-M02 **2 FAIL**, N05 **1 FAIL**: base của note đang lưu bị nâng từ 0 lên 1 bởi dữ liệu phiên khác; retry dùng base 1, ghi đè note của phiên đó, unsaved rỗng và luồng duyệt tiếp tục. |

Không có finding riêng mới ngoài phần còn thiếu của S3-08; bảy finding đã đóng tiếp tục đạt các control.

## 4. S3-08 — Phần đã đóng và nhánh còn lỗi

### Những gì đã được xác nhận sửa đúng

- `save-draft/route.ts:264`, `:372`, `:421` trả `acceptedFields`, `staleFields` và `partialStale`; request vừa nhận finalText vừa bỏ teacherNote đã phản ánh chính xác kết quả từng trường.
- `page.tsx:1997`, `:2020`, `:2028`, `:2043` chỉ xác nhận/xóa các trường được nhận; trường stale được giữ và được thông báo đúng giá trị máy chủ tại `:2079`..`:2192`.
- **R3-M01 và N04:** sau lỗi note đã được ghi nhận, tab khác sửa note, retry gộp note + finalText → DB giữ note tab kia, nhận finalText mới; flush=false, reload vẫn giữ note cục bộ, `fieldReasons.teacherNote='stale'`.
- Chạy AI, duyệt riêng, duyệt cả lớp và duyệt/đẩy khi đang có khóa stale không phát request phụ thuộc. Sửa finalText thêm hai lần vẫn không đẩy note stale; chủ động sửa note mới giải quyết được khóa. Đã kiểm thêm chiều ngược: finalText xung đột, sửa note vẫn giữ khóa, sửa lại finalText mới giải quyết.
- Khi note **đã thành lỗi** trong `unsavedDraftPatchRef`, phản hồi điểm danh hoặc preserving reload giữ đúng base cũ và retry phát hiện xung đột. Hai control này đều PASS.

### Nguyên nhân còn lại

Các đoạn bảo toàn metadata chỉ duyệt `unsavedDraftPatchRef` và `debouncedPayloadsRef`. Khi request note **đã gửi và còn đang chờ**, payload đã bị lấy ra khỏi debounce nhưng chưa trở thành unsaved. Vì vậy, note không nằm trong hai danh sách này, dù promise của nó vẫn đang được theo dõi.

Một phản hồi lưu trường khác mang theo metadata toàn hàng, hoặc `loadClassData(..., {preserveLocalUnsavedEdits:true})`, có thể cập nhật note sang version của tab khác. Client giữ chữ note cục bộ trên màn hình nhưng đã mất mốc mà chữ đó dựa vào. Khi request note trả lỗi và được thử lại, `fbaseEntries` lấy mốc vừa bị nâng nhầm, làm server hiểu rằng client đã biết phiên bản mới và cho phép ghi đè.

Đây là lỗi giữ mốc phiên bản, không phải server bỏ qua `staleFields`: request retry đã gửi một base mới không đúng với nội dung mà người dùng từng thấy.

### Tái hiện R4-M02 và N05

1. UI có note `ORIGINAL NOTE`, base teacherNote 0. Giáo viên nhập `INFLIGHT LOCAL NOTE`; blur gửi request A. Giữ chậm A, chưa trả kết quả.
2. Tab khác lưu `REMOTE NOTE MUST SURVIVE` qua route thật, dùng base 0. DB note trở thành version 1.
3. Khi A vẫn chờ, cho một request trường khác thành công. VM dùng điểm danh `LATE`; Chromium N05 dùng nhập/blur finalText thật. Phản hồi B chứa metadata note version 1 nhưng không ghi note. **Client nhận note base 1**, dù giáo viên chưa sửa lại note hoặc xác nhận xung đột.
4. A trả HTTP 500. UI giữ note cục bộ như lỗi mạng thông thường, `fieldReasons.teacherNote='error'`.
5. Retry: VM gọi flush; Chromium bấm **Duyệt & Lưu riêng**. Request C gửi `fbase=teacherNote:1`, thay vì giữ base 0.
6. Server chấp nhận C, **note của tab khác bị ghi đè**. VM nhận retry=true, unsaved=null. Chromium tiếp tục approve và phát request save-lms tới transport giả.

R4-M02 có nhánh thứ hai: bước 3 thay bằng preserving reload khi A đang chờ. UI vẫn giữ note cục bộ, nhưng metadata cũng bị nâng base lên 1; retry ghi đè tương tự.

**Bằng chứng VM rút gọn, cả hai nhánh cùng kết quả:**

```json
{
  "remoteHttp": 200,
  "adoptedBase": 1,
  "unsavedBefore": {
    "patch": { "teacherNote": "INFLIGHT LOCAL NOTE", "status": "DRAFT" },
    "fieldReasons": { "teacherNote": "error" }
  },
  "retry": true,
  "dbTeacherNoteAfterRetry": "INFLIGHT LOCAL NOTE",
  "unsavedAfter": null,
  "retryRequestFieldBase": "teacherNote:1"
}
```

**Bằng chứng Chromium N05:**

```json
{
  "adoptedBase": 1,
  "lmsRequested": true,
  "dbTeacherNoteAfterRetry": "INFLIGHT NATIVE LOCAL NOTE",
  "dbFinalText": "UNRELATED NATIVE FINAL",
  "dbStatus": "APPROVED",
  "unsaved": null,
  "pageErrors": []
}
```

Các request quan sát được trong Chromium:

| Request | Nội dung chính | Mốc phiên bản |
|---|---|---|
| A — giữ chậm, sau đó trả 500 | teacherNote cục bộ | `rev=2`, `base=1`, `fbase=teacherNote:0` |
| B — thành công trước A | strengths/improvements/actionPlan/finalText, **không sửa teacherNote** | `rev=4`, base các trường nhận xét 0; phản hồi mang note metadata version 1 của tab khác |
| C — retry note | teacherNote cục bộ cũ | `rev=5`, `base=3`, **`fbase=teacherNote:1`** |
| D — approve | finalText mới | `expectedRowVer=4` |
| E — save-lms | đúng classId/classCode/sessionId/studentId | Đã phát tới route/hàng đợi thật, mock tại CommentSaver |

Không sửa note cục bộ lần thứ hai giữa A và C. Không tự điền base mới từ harness; giá trị sai được chính handler ứng dụng tạo ra. Cập nhật tab khác đi qua route thật, không chỉnh SQLite trực tiếp để tạo xung đột. **Không ghi LMS thật**: `lmsRequested:true` chỉ chứng minh luồng hiện tại không chặn hành động phụ thuộc; mock LMS không đánh dấu VERIFIED trong DB.

**Tác động:** mốc chống ghi đè bị mất khi mạng chậm và có hai phiên chỉnh sửa. Bản note mới của tab khác có thể bị thay mà giáo viên chưa được xem/giải quyết xung đột. Đây là dữ liệu giả trong kiểm định, không có bằng chứng note thật của Owner đã bị mất.

### Cách sửa tối thiểu và kiểm tra lại

Bổ sung bảo toàn base cho **từng trường còn request chưa được xác nhận**, không chỉ phần đang debounce hoặc đã được gắn lỗi. Dùng trạng thái phiên bản trường đang có để nhận biết chỉnh sửa chưa được xác nhận, hoặc giữ base cùng payload request đang chạy; một phản hồi của trường khác không được thay base của trường đó. Áp dụng cùng quy tắc khi preserving reload và khi lấy metadata để hiển thị xung đột. Chỉ cập nhật mốc thích hợp sau xác nhận đúng trường hoặc sau thao tác chủ động xử lý xung đột.

Kiểm thử cần giữ nguyên thứ tự **A đang chờ → tab khác ghi → B thành công/reload → A lỗi → retry**, không trả lỗi A sớm như test tại `scripts/test-streamline-v340-s3.ts:894`. Kỳ vọng: retry vẫn dùng base 0, server từ chối note cũ, note DB của tab kia còn nguyên, note cục bộ được giữ với lý do stale, flush=false và không gọi approve/save-lms. Giữ control R3-M01/N04 cùng việc sửa đúng trường để giải quyết xung đột.

## 5. Đối chiếu control và sáu quy tắc dự án

| Nhóm | PASS / tổng | Kết quả chính |
|---|---:|---|
| P01..P22 | **23/23** | Debounce, lỗi lưu, batch từng phần, phiên bản/hash, guard status DB, mẫu tùy chỉnh, sửa trong lúc duyệt, phản hồi ngược thứ tự. |
| Q01 | **2/2** | Payload cả lớp/từng dòng qua route save-lms và hàng đợi thật. |
| Q02 | **4/4** | Sửa khi duyệt; phục hồi thành công/thất bại ở cả hai nút. |
| Q03/Q04 | **1/1; 1/1** | Lưu chéo trường HTTP 500; reload giữ phần lỗi. |
| Q05/Q06 | **28/28; 2/2** | Sai kiểu dữ liệu và ngoại lệ repository trong batch. |
| Q07/Q08 | **6/6; 4/4** | Guard status DB và approvedText sai kiểu. |
| Q09/Q10/Q11 | **1/1; 4/4; 1/1** | Beforeunload, mẫu/Phần 2, debounce/blur chéo trường. |
| Network/stale toàn request | **2/2** | Giữ bản lỗi, thử lại và chặn đúng xung đột toàn request. |
| Closure R3-M01 và mở rộng | **9/9** | Partial acceptance, giữ khóa, chặn hành động, giải quyết chủ động, bảo toàn base sau lỗi đã ghi nhận. |
| Native N01..N04 và mở rộng | **7/7** | Nhập/blur/retry, sửa khi duyệt, dialog thật, giữ bản xung đột qua reload và sửa trường khác. |
| R4-M02/N05 | **0/3** | Ba quan sát thuộc nhánh in-flight của S3-08 còn OPEN. |

- **Nguồn chuẩn:** đã đối chiếu hồ sơ và bản sửa thực tế; không đánh dấu S3 hoàn tất, không sửa ba tài liệu theo dõi.
- **Nội bộ/bí mật/Allowlist:** không thay cấu hình bind; engine Zalo vẫn không nhập module server/secret vào client. Test có đủ đường dữ liệu TEMP; không mở Student Portal/tunnel, không sử dụng tài khoản thật.
- **Playwright/checkpoint/xác minh:** route save-lms giữ hàng đợi thật; bộ browser và mã checkpoint/xác minh sau ghi không thay đổi trong bản sửa. Hồi quy Chromium chạy được. Không dùng Persistent Context Owner để đăng nhập; các context test dùng dữ liệu giả và đóng sau từng case.
- **Toàn vẹn/hash:** P11..P14 tiếp tục đạt. S3-08 còn lỗi trước bước duyệt: hash của bản đã được ghi không chứng minh việc áp dụng base mới cho bản chưa lưu là hợp lệ.
- **AI/Zalo/SPCK:** guardrails và hồi quy chạy offline; mẫu tùy chỉnh/ngày kế tiếp/Phần 2 tiếp tục đạt. Không chứng nhận AI/OCR hoặc nộp sản phẩm lên dịch vụ thật. Không thay quy tắc logo mặc định.
- **Vai trò/giao tiếp:** audit trực tiếp theo chỉ định Owner, không thực hiện sửa sản phẩm và không yêu cầu Owner thao tác kỹ thuật.

## 6. Production Data Preservation Check và fingerprint

Chỉ đọc nội dung hai tệp production bằng ngoại lệ đo hash đã được cho phép:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath 'data/mindx_bot.db', 'data/running_classes.json'
```

| Tệp | SHA-256 trước | SHA-256 sau | Kết quả |
|---|---|---|---|
| `data/mindx_bot.db` | `28574C5708D04162B18D65746EC8788C456274E206542255206CE5084E446ED7` | `28574C5708D04162B18D65746EC8788C456274E206542255206CE5084E446ED7` | **UNCHANGED — MATCH** |
| `data/running_classes.json` | `ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2` | `ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2` | **UNCHANGED — MATCH** |

Không mở SQLite, sao chép, sửa hoặc xóa hai tệp production. Đối chiếu **2.298 tệp có sẵn** trong `src`, `scripts`, `docs`, `data/config`, `.agents` và các tệp gốc: không tệp nào đổi hash, kích thước hoặc thời gian ghi. Phép đo gồm tệp chưa commit, toàn bộ hồ sơ Round 1..3 và audit lịch sử; không chỉ dựa vào Git diff.

| Tệp | SHA-256 trước/sau giống nhau |
|---|---|
| `src/app/api/session-comments/save-draft/route.ts` | `94fb00b6773c45a6c0a56cec72d3847d127eb732f062773d5dc5c208196936ae` |
| `src/app/session-comments/page.tsx` | `edfdaa9f2e9bbbdf3e4c809d2b124f5e8e5ab4732c80eba6e4d791b11dce0f24` |
| `scripts/test-streamline-v340-s3.ts` | `542be73f9fc79a1863513c91cd9b7583a0db3d03d9899fc15034d8bdbf5d6f97` |
| `src/app/api/session-comments/approve/route.ts` | `456eb64636add416ac0f89390e059bebfdb6e79b4caacf23912f3cc23f9fd65f` |
| `src/lib/zalo/zalo-summary.ts` | `c260c785bc89aecdd7b4682b060eafe63aa21cc19ec1c9ac3bad2e5df6ad373c` |
| `src/lib/zalo/broadcast-generator.ts` | `57ac4e5e6dcea7f5dfdc683ccc260a017dade8a06d1a3c7b228ac06fe9c474b4` |
| `src/app/api/session-comments/zalo-btvn-image/route.ts` | `a0999ba3bfd2c0572c1b5d4436b0c8405c7f6786b9c17d203db86b39de26bb0c` |
| Probe P gốc và bản sao đã chạy | `56d820c15020797635c437a310891fcc07480dc26f947ab036e6ac06d26257cf` |

Mọi scratch/log/DB giả chỉ nằm trong TEMP; bằng chứng quyết định đã tổng hợp trong báo cáo này. **Đã dọn toàn bộ thư mục audit bằng Node `fs.rmSync(target, {recursive:true, force:true})`, exit 0; kiểm tra sau xóa trả `auditTempDeleted:true`.** Trước xóa đã kiểm tra đường dẫn nằm trong Windows TEMP và không phải liên kết. Không dùng PowerShell xóa đệ quy và không tạo thêm thư mục bằng chứng trong checkout. Kiểm tra bổ sung xác nhận báo cáo này là tệp mới duy nhất trong các vùng được theo dõi, không có tệp có sẵn nào bị đổi/mất.

## 7. Điều kiện GO và giới hạn

1. Giữ nguyên phần R3-M01/N04 đã sửa đúng; bổ sung bảo toàn base cho trường có request đang chạy trong cả merge metadata và preserving reload.
2. Chạy lại R4-M02 hai nhánh và Chromium N05, xác nhận không ghi đè note tab khác, còn bản cục bộ/stale, chặn approve/save-lms. Giữ control chủ động sửa đúng trường để giải quyết xung đột.
3. Chạy lại đủ 15 gate trên cây mã mới và các control P/Q/N; chốt fingerprint và hai hash production bằng ngoại lệ chỉ đọc.

**Chưa kiểm tra:** LMS/Teaching/Gemini/Zalo thật, Next production build/dev server, đóng cưỡng bức/mất điện hoặc bảo đảm mọi keepalive được nhận khi chọn rời trang. N03 xác nhận dialog thật và chọn ở lại; không phải cam kết chống mất dữ liệu tuyệt đối. Không nghiệm thu S4..S8/toàn bộ v3.4.0.

**Đã làm:** hoàn tất audit Round 4, ghi báo cáo và giữ nguyên sản phẩm. **Kết quả:** NO-GO; S3-01..S3-07 CLOSED, S3-08 HIGH còn OPEN ở nhánh request đang chờ. **Việc tiếp theo:** bên triển khai sửa phần bảo toàn base còn thiếu rồi gửi kiểm định lại; Owner không cần chạy lệnh cho lượt này.
