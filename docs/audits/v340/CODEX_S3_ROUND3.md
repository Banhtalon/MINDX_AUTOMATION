# Kiểm định độc lập v3.4.0 — S3, Round 3

**Decision: NO-GO cho Stage S3 Round 3.**

Ngày kiểm định: **30/10/2026**. Baseline và HEAD: **`ab3f570e57c908bf5d19e3df10a563efc45616f6`**. Đối tượng kiểm định là **cây làm việc**, gồm cả mã/test S3 chưa được Git theo dõi. Codex thực hiện trực tiếp vai trò kiểm định độc lập do Owner yêu cầu; không gán kết quả cho Claude hoặc một reviewer không được gọi.

**Đóng cả 7 finding cũ S3-01..S3-07 trong các tình huống đã ghi nhận. Chạy mới đủ 15/15 gate, lượt cuối đều exit 0; P01..P22 đạt 23/23, Q01..Q11 đạt 54/54. Tuy nhiên, phát hiện thêm S3-08 HIGH: lưu gộp nhiều trường có thể bỏ qua một trường xung đột nhưng giao diện vẫn xác nhận đã lưu hết, xóa dấu chưa lưu và làm mất ghi chú cục bộ khi tải lại.** Lỗi mới được tái hiện bằng cả VM và Chromium thật, cùng route và SQLite TEMP thật. Vì vậy, các gate xanh chưa đủ để nghiệm thu S3.

Hai tệp production giữ nguyên SHA-256 và khớp giá trị Owner cung cấp. **2.287/2.287 tệp có sẵn được bảo toàn SHA-256, kích thước và thời gian ghi.** Không sửa ứng dụng, test hiện có, `next-env.d.ts`, ba tài liệu theo dõi hoặc hồ sơ kiểm định trước. Báo cáo này là tệp bàn giao mới duy nhất trong checkout.

## 1. Phạm vi, phương pháp và cách ly

- Đọc `PROJECT_STATE.md` đầu tiên, đối chiếu Giai đoạn 10/S3 trong `MINDX_AUTOMATION_PLAN.md`, `CHANGELOG.md`, hai báo cáo S3 trước và `AGENTS.md`. S3 vẫn đang chờ nghiệm thu trong kế hoạch.
- Áp dụng `ponytail-audit` và `verify-and-stop`: lần theo luồng nhập → lưu nháp → duyệt → hàng đợi → đẩy LMS; xác minh các finding bằng tình huống cụ thể, không sửa sản phẩm. Giả định ứng dụng nội bộ một giáo viên; vẫn kiểm tra hai tab vì cơ chế phiên bản hiện có chủ động hỗ trợ và cảnh báo tình huống này.
- Đọc phần liên quan của hướng dẫn Route Handlers trong `node_modules/next/dist/docs/`; đối chiếu các route lưu nháp/duyệt/save-lms/list, SQLite, hàng đợi, bộ ghi LMS, engine Zalo, cấu hình và các đoạn mã S3 thay đổi so với baseline.
- Bản sao thử nằm tại `C:\Users\QQ\AppData\Local\Temp\mindx-s3-r3-audit-20261030\workspace`. Sao chép mã/test, `data/config`, skills và các tệp phục vụ test, bao gồm `AGENTS.md`, `GEMINI.md`, `PROJECT_STATE.md`, `start-bot.bat`, `start-bot.command`. **Không sao chép DB/cache lớp thật, `.env*` hoặc `playwright-auth`.** Không chạy các script khởi động đã sao chép.
- Mỗi tiến trình test/probe có `ALLOWED_LOCAL_DIRS`, `MINDX_DB_PATH`, `MINDX_RUNNING_CLASSES_PATH` trỏ vào thư mục con TEMP. `TEMP`/`TMP` của tiến trình con cũng nằm dưới thư mục audit để gom các thư mục phụ. Các suite tự ghi đè đường DB tương đối vẫn chạy trong workspace TEMP. Đặc biệt, Quick Tags được cấp đủ override từ bên ngoài.
- Chạy mã TypeScript bằng loader SWC đã được Owner cho phép: `@next/swc-win32-x64-msvc`, `require.extensions['.ts' / '.tsx']`, `Module._resolveFilename`; alias `@/` trỏ vào mã trong mirror. Thư viện dùng bản đã cài trong checkout. Không cài thêm thư viện, không tạo junction `node_modules`, không đổi assertions của các suite.
- Chặn TCP ra ngoài trước khi nạp suite, buộc Chromium dùng proxy loopback không hoạt động; các trang giả được test cung cấp bằng route mock. Dùng `GEMINI_API_KEY=audit-synthetic-offline-key`, không dùng khóa thật. Loader chặn đọc/mở/ghi/sao chép hai đường dẫn dữ liệu production. Không gọi LMS/Teaching/Gemini thật, gửi tin Zalo hoặc mở portal/tunnel.
- P01..P22 chạy từ **bản sao nguyên tệp** `docs/audits/v340/s3-round1/adversarial.cjs`. Round 2 không lưu lại mã Q01..Q11 sau khi dọn TEMP; lượt này dựng lại **đúng các tình huống và 54 quan sát được mô tả trong báo cáo Round 2**, không tuyên bố có bản mã Q gốc để so sánh từng byte.
- Probe Q01 dùng **route save-lms thật và `taskQueue.enqueue` thật**, chỉ thay `CommentSaver.saveComments` tại ranh giới tác động LMS. Probe component khác dùng handler thật, route thật và SQLite TEMP thật; React hooks/mạng chậm/lỗi được điều khiển trong VM.
- Kiểm tra native dùng Chromium và React thật, bundle trang `/session-comments` cùng JSX hiện tại. Chỉ chèn điểm quan sát vào bản sao ngoài `src/**` trong TEMP; không thay logic handler. Playwright cung cấp trang và API qua route mock; các API lưu/duyệt/list/save-lms gọi handler thật với SQLite TEMP. Đây là bằng chứng hành vi trình duyệt, chưa phải chạy Next server hay nghiệm thu giao diện đầy đủ.
- Không cập nhật ba tài liệu trạng thái/kế hoạch/changelog: lượt audit này chỉ tạo báo cáo, giữ phạm vi cô lập của Owner và không công nhận S3 hoàn tất.

## 2. Gate Execution Summary

Ký hiệu lệnh thực thi thực tế:

```text
CHECKOUT = F:\MINDX_project test\MINDX-AUTOMATION
TEMP     = C:\Users\QQ\AppData\Local\Temp\mindx-s3-r3-audit-20261030
SWC      = node <TEMP>\loader.cjs scripts\<suite>.ts
           (cwd: <TEMP>\workspace; có đủ ba override dữ liệu TEMP)
TSC      = node <CHECKOUT>\node_modules\typescript\bin\tsc --noEmit --incremental false
           (cwd: CHECKOUT; có đủ ba override dữ liệu TEMP)
```

Các đường dẫn có khoảng trắng được truyền thành đối số riêng bằng Node `spawnSync`, hoặc được PowerShell truyền qua biến. SWC là đường thực thi gate chính thức đã được prompt cho phép, không phải suy đoán kết quả `npx`. Bảng dưới dùng **exit của từng tiến trình**, không dùng exit của chương trình điều phối để thay thế.

### 15 lệnh bắt buộc — chạy mới

| # | Lệnh yêu cầu | Thực thi | Exit thực tế | Kết quả |
|---:|---|---|---:|---|
| 1 | `npx tsc --noEmit --incremental false` | TSC | **0** | PASS, không ghi build tăng dần. |
| 2 | `npx tsx scripts/test-streamline-v340-s3.ts` | SWC | **0** | Đủ 6 phần; gồm HTTP 500, lỗi kết nối, reload/retry và route save-lms thật. |
| 3 | `npx tsx scripts/test-quick-tags-v300.ts` | SWC | **0** | PASS trên DB TEMP. |
| 4 | `npx tsx scripts/test-streamline-v340-s1.ts` | SWC | **0** | PASS. |
| 5 | `npx tsx scripts/test-streamline-v340-s2.ts` | SWC | **0** | PASS. |
| 6 | `npx tsx scripts/test-phase5.ts` | SWC | **0** | PASS. |
| 7 | `npx tsx scripts/test-phase6.ts` | SWC | **0** | PASS; Chromium chạy được. |
| 8 | `npx tsx scripts/test-phase7.ts` | SWC | **0** | PASS trong mirror, không ghi cấu hình checkout. |
| 9 | `npx tsx scripts/test-phase4-codex-repros.ts` | SWC | **0** | PASS. |
| 10 | `npx tsx scripts/test-spck-v270.ts` | SWC | **0** | PASS. |
| 11 | `npx tsx scripts/test-spck-v272.ts` | SWC | **0** | PASS. |
| 12 | `npx tsx scripts/test-lms-reliability-v280.ts` | SWC | **0** | PASS. |
| 13 | `npx tsx scripts/test-session14-v290.ts` | SWC | **0** | Đủ S14-01..S14-07, gồm Playwright. |
| 14 | `npx tsx scripts/test-teaching-project-v320.ts` | SWC | **1 → 1 → 1 → 0** | Lượt cuối đủ TP-01..TP-06. Các lỗi thiết lập mirror được ghi riêng bên dưới. |
| 15 | `npx tsx scripts/test-report-card-v330.ts` | SWC | **0** | Đủ RC-01..RC-06. |

**15/15 gate có lượt cuối exit 0.** Không còn gate bị `spawn EPERM` như Round 2. Không chạy build hoặc dev server vì không thuộc 15 gate được yêu cầu.

### Probe độc lập, kiểm tra bảo toàn và exit code

| Lệnh thực thi | Exit | Kết quả |
|---|---:|---|
| `node <TEMP>\loader.cjs <TEMP>\adversarial.cjs` | **0** | **23 PASS / 0 FAIL**, nguyên P01..P22; P15 có hai trạng thái. |
| `node <TEMP>\loader.cjs <TEMP>\q.cjs` | **1 → 0** | Lượt cuối **56 PASS / 0 FAIL** = Q01..Q11 **54/54** + hai ca mở rộng network/stale **2/2**. |
| `node <TEMP>\loader.cjs <TEMP>\native.cjs` | **1 → 0** | Lượt cuối **4 PASS / 0 FAIL**: blur/retry, sửa khi duyệt với phục hồi thành công/thất bại, hộp thoại beforeunload thật. |
| `node <TEMP>\loader.cjs <TEMP>\mixed.cjs` | **1** | **1 FAIL**: lưu gộp có một trường bị bỏ qua → S3-08. |
| `node <TEMP>\loader.cjs <TEMP>\native-mixed.cjs` | **1** | **1 FAIL**: xác nhận S3-08 bằng nhập/blur và reload trên Chromium thật; không có lỗi JavaScript của trang. |
| `node <TEMP>\preservation.cjs` | **0** | **2.287/2.287 tệp** giữ hash, kích thước và thời gian ghi; không đổi/mất tệp. |
| `Get-FileHash -Algorithm SHA256 -LiteralPath 'data/mindx_bot.db', 'data/running_classes.json'` trước/sau | **0; 0** | Khớp 100% hai giá trị kỳ vọng. |
| `node -e "...fs.rmSync(target,{recursive:true,force:true})..."` | **0** | Đã kiểm tra target là thư mục audit con trực tiếp trong Windows TEMP, không phải liên kết; `auditTempDeleted:true`. |

### Các lượt lỗi thiết lập — phân biệt với lỗi ứng dụng

- **Teaching v320:** lượt đầu TP-01..TP-05 đạt, TP-06 không tìm được React/lucide khi `esbuild.build` chạy trong mirror. Wrapper ban đầu chỉ thử xử lý `buildSync`. Lượt chẩn đoán kế tiếp thiếu `NODE_PATH`, bộ phân giải theo đường tuyệt đối không xử lý được package exports của `@tailwindcss/postcss`, exit **1**. Lượt tiếp theo đã khôi phục phân giải package nhưng gán vào export getter của esbuild không thay được `build`, vẫn exit **1**. Cuối cùng, loader TEMP trả wrapper rõ ràng cho cả `build` và `buildSync`, chỉ bổ sung `nodePaths` về thư viện đã cài; nguyên suite đạt exit **0**. Không sửa suite/assertions hoặc cài thư viện.
- **Q, lượt đầu:** mock LMS của chính auditor gọi nhầm tên helper repository `findByClassSession`; hai ca Q01 trả 500 do harness, tổng **54 PASS / 2 FAIL** trên 56 quan sát. Sửa duy nhất mock TEMP thành `findBySession`, chạy lại DB TEMP mới đạt **56/56**, exit **0**. Đây không phải finding sản phẩm.
- **Native, lượt đầu:** harness truyền cả đối tượng Playwright vào `page.evaluate`, không thể chuyển thành dữ liệu gửi cho trang, exit **1**. Chỉ truyền `{classId, sessionId}` rồi chạy lại DB TEMP mới đạt đủ **4/4**, exit **0**.
- S3 suite chủ động ném `INJECTED_NETWORK_DISCONNECT`; dòng lỗi này là dữ kiện kiểm thử được mong đợi và suite vẫn exit **0**. Không suy ra thất bại chỉ từ một dòng stderr.

Các lệnh đọc/tìm kiếm, xem Git và chuẩn bị mirror không phải gate nghiệm thu. Hai probe mixed-field exit 1 là lỗi hành vi thật đã chạy đến kiểm tra kết quả, không phải lỗi thiết lập.

## 3. Finding Table

Số dòng áp dụng cho cây nguồn có fingerprint ở mục 7.

| ID | Severity | Status | Vị trí chính xác | Bằng chứng Round 3 / căn cứ đóng |
|---|---|---|---|---|
| **S3-01** | HIGH | **CLOSED** | `src/app/session-comments/page.tsx:390`, `:1214`, `:1691`, `:1764`, `:1879`, `:1948` | Q03/Q11: B lưu finalText thành công trước, A lưu teacherNote trả HTTP 500 sau; flush đợi A và trả false, giữ ghi chú qua reload, retry lưu được cả hai trường. Ca network exception và staleIgnored toàn request cũng PASS. S3 suite section 6 và native N01 xác nhận thêm. Đóng tình huống lỗi HTTP/network chéo trường đã ghi ở R2; hợp đồng lưu từng phần mới phát hiện được tách thành S3-08. |
| **S3-02** | HIGH | **CLOSED** | `src/app/session-comments/page.tsx:2546`, `:2657`, `:2859`, `:3038`, `:3077` | P17; Q02 4/4 cho cả lớp/từng dòng × phục hồi thành công/thất bại. Không gửi save-lms khi có sửa trong lúc duyệt, giữ bản mới. N02 xác nhận bằng nhập thật trong Chromium. Thông báo phân biệt đúng đã lưu và phục hồi thất bại. Khi ép ghi phục hồi lỗi, DB vẫn có thể APPROVED bản cũ, nhưng luồng hiện tại chặn đẩy và giữ bản mới; không tuyên bố DB đã hạ DRAFT trong ca ghi thất bại. |
| **S3-03** | HIGH | **CLOSED** | `src/app/session-comments/page.tsx:1290`, `:1309`, `:1745` | P07/P08 và Q09: phát đủ các hàng đồng thời, keepalive và tín hiệu cảnh báo rời trang. N03: Chromium hiện dialog loại `beforeunload`, người dùng giả lập chọn ở lại, ba yêu cầu đều `keepalive:true` đã tới transport giả. Không khẳng định dữ liệu luôn tới máy chủ nếu chọn rời trang hoặc đóng cưỡng bức. |
| **S3-04** | MEDIUM | **CLOSED** | `src/app/api/session-comments/save-draft/route.ts:159`, `:184`, `:203`, `:486` | P10, Q05 **28/28**, Q06 save: A hợp lệ/B sai kiểu hoặc repository ném lỗi/C hợp lệ → đủ results, A/C được xử lý, không che giấu phần đã ghi. |
| **S3-05** | MEDIUM | **CLOSED** | `src/app/api/session-comments/approve/route.ts:76`, `:101`, `:328` | P15 hai trạng thái; Q07 **6/6** không bỏ qua guard DB bằng bỏ/giả status. Q08 **4/4** từ chối approvedText sai kiểu; Q06 approve vẫn trả kết quả từng hàng khi repository ném lỗi. |
| **S3-06** | LOW | **CLOSED** | `src/lib/zalo/broadcast-generator.ts:167`, `:171`, `:187` | P16 và Q10 **4/4**: sửa đúng mẫu chuẩn thành `OWNER_CUSTOM {{className}}` được giữ; mẫu chuẩn/tùy chỉnh × có/không ảnh đều đúng quy tắc Phần 2. Chỉ đổi cấu hình bản sao rồi phục hồi bản sao. |
| **S3-07** | HIGH | **CLOSED** | `src/app/session-comments/page.tsx:2983`; `scripts/test-streamline-v340-s3.ts:422`; bên nhận `src/app/api/session-comments/save-lms/route.ts:15` | Q01 **2/2**: cả lớp/từng dòng → route thật → hàng đợi thật → mock CommentSaver; HTTP **200**, có đúng `classCode`, từng dòng có đúng studentId. S3 suite và N01 xác nhận thêm. Không dùng thành công giả trực tiếp ở `/save-lms` để kết luận đóng. |
| **S3-08** | **HIGH** | **OPEN** | `src/app/api/session-comments/save-draft/route.ts:299`, `:350`, `:382`, `:405`; `src/app/session-comments/page.tsx:1230`, `:1878`, `:1892`, `:1916` | **R3-M01 và N04 FAIL:** sau lỗi lưu note, tab khác lưu note mới; retry gộp note cục bộ với finalText mới. Server bỏ note xung đột nhưng nhận finalText, trả HTTP 200/success:true không có staleIgnored. Client xác nhận mọi explicitFieldKeys, hết dấu chưa lưu, flush=true. Reload có preserveLocalUnsavedEdits vẫn thay note cục bộ bằng note của tab kia. |

Không có finding CRITICAL. Bảy finding cũ đã có chứng cứ đóng; **S3-08 vẫn chặn GO**.

## 4. S3-08 — Ghi chú bị mất khi chỉ một phần yêu cầu được chấp nhận

**Nguyên nhân:** máy chủ đánh giá độ mới riêng từng trường nhưng chỉ báo `staleIgnored` khi **tất cả** các trường đều bị bỏ qua. Khi ít nhất một trường được nhận, nó trả thành công chung. Client dùng thành công này để đánh dấu **toàn bộ trường đã gửi** là đã xác nhận. Việc theo dõi đủ các promise không phát hiện được trường bị từ chối nằm bên trong một phản hồi HTTP 200.

**Tái hiện mới trên VM và Chromium, dữ liệu giả:**

1. Mở lớp/buổi có note `ORIGINAL NOTE`, finalText `ORIGINAL TEXT`; giao diện đang giữ teacherNote version 0.
2. Nhập `LOCAL NOTE MUST SURVIVE`; blur gửi A. Ép A trả HTTP 500. UI giữ note và đánh dấu chưa lưu — bước này đúng.
3. Một phiên khác (`cid=OTHER_TAB`) lưu `teacherNote='OTHER TAB NOTE'`, base teacherNote 0. Route thật trả 200; DB note lên version 1. UI phiên đầu vẫn biết base 0.
4. Phiên đầu sửa finalText thành `LOCAL FINAL TEXT`, blur. `flushPendingDraftSave` gộp note chưa lưu và các trường nhận xét vào B, `fbase=teacherNote:0,...,finalText:0`.
5. Máy chủ thấy note B cũ hơn version 1 nên giữ note của tab kia; finalText B còn mới nên được ghi. Phản hồi B là 200/success:true, metadata note thuộc `OTHER_TAB`, không có `staleIgnored`.
6. Client coi note đã được lưu, vùng unsaved rỗng và `flushAllPendingDraftSaves()` trả true. Tải lại có `preserveLocalUnsavedEdits:true` làm note cục bộ biến mất.

Kết quả VM rút gọn:

```json
{
  "firstSave": false,
  "remoteHttp": 200,
  "flush": true,
  "response": {
    "http": 200,
    "body": {
      "success": true,
      "versionMeta": {
        "rowVer": 3,
        "fields": {
          "teacherNote": { "ver": 1, "cid": "OTHER_TAB", "rev": 1 },
          "finalText": { "ver": 1, "cid": "<local-client>", "rev": 4 }
        }
      }
    }
  },
  "beforeReload": {
    "uiNote": "LOCAL NOTE MUST SURVIVE",
    "dbNote": "OTHER TAB NOTE",
    "dbText": "LOCAL FINAL TEXT",
    "unsaved": null
  },
  "afterReloadNote": "OTHER TAB NOTE"
}
```

**Kiểm chứng native N04:** dùng `.fill()` vào textarea thật và Tab để blur. Sau retry: `flushed:true`, `unsaved:null`, DB note `REMOTE NATIVE NOTE`, DB finalText `LOCAL NATIVE FINAL TEXT`; reload đổi textarea từ `LOCAL NATIVE NOTE MUST SURVIVE` sang `REMOTE NATIVE NOTE`. Trang không phát sinh lỗi JavaScript. Cập nhật của phiên khác được đưa qua route thật, không sửa DB trực tiếp để tạo xung đột. Không cần dữ liệu/tài khoản Owner để chứng minh.

**Tác động:** giáo viên mất bản ghi chú đang sửa và có thể tiếp tục AI/duyệt do lớp chờ lưu báo đã xong. DB vẫn bảo vệ được note mới của tab khác; lỗi là client bỏ mất bản cục bộ chưa được server nhận. Không có bằng chứng ghi chú thật của Owner đã từng mất.

**Xuất xứ:** `git show ab3f570:src/app/api/session-comments/save-draft/route.ts` xác nhận cơ chế nhận/bỏ từng trường và chỉ báo stale khi tất cả bị bỏ đã có trong baseline. Lượt này xác nhận sự không khớp với cơ chế gộp/thử lại/đánh dấu xác nhận của S3 hiện tại. Không quy toàn bộ cơ chế server này là hồi quy mới do hai bản sửa Round 3.

**Cách sửa nhỏ, trong phạm vi:** route trả rõ trường nào được nhận và trường nào xung đột; client chỉ xác nhận/xóa những trường được nhận, giữ trường bị từ chối cùng giá trị mới nhất và trả false nếu còn trường chưa xác nhận. Giữ phần finalText đã lưu thành công; không tự ghi đè note của tab khác hoặc tự coi tải lại là đã giải quyết xung đột.

**Sau khi sửa:** thêm ca đúng chuỗi trên, xác nhận UI/reload còn note cục bộ, DB giữ note của tab kia và finalText mới, flush=false; AI/duyệt/đẩy bị chặn tới khi giáo viên xử lý bản xung đột. Chạy lại cả đường native và các control Q03/Q11/network/stale toàn request. Chỉ kiểm tra HTTP 500 hoặc staleIgnored toàn request sẽ bỏ sót lỗi này.

## 5. Đối chiếu P/Q và sáu quy tắc dự án

| Nhóm | PASS / tổng | Nội dung kiểm chứng |
|---|---:|---|
| P01..P22 | **23/23** | Debounce/flush, chặn hành động sau lưu lỗi, dispatch khi rời trang, partial batch, phiên bản/hash, guard status DB, sửa lúc duyệt, mẫu chuẩn tùy chỉnh, đường thuận và phản hồi ngược thứ tự. P15 chạy hai trạng thái. |
| Q01 | **2/2** | Payload hai nút qua save-lms thật và hàng đợi thật. |
| Q02 | **4/4** | Cả lớp/từng dòng × phục hồi thành công/thất bại, chặn đẩy và báo đúng tình trạng. |
| Q03 | **1/1** | Hai trường lưu ngay, B thành công trước, A HTTP 500 sau; đợi đủ, giữ note và retry. |
| Q04 | **1/1** | Reload giữ bản lỗi đã được đánh dấu. |
| Q05 | **28/28** | Bảy trường × bốn kiểu sai, bảo toàn hai hàng hợp lệ. |
| Q06 | **2/2** | Ngoại lệ repository ở giữa batch save và approve. |
| Q07 | **6/6** | Hai status DB bị cấm × ba cách bỏ/giả status bên gọi. |
| Q08 | **4/4** | Bốn kiểu approvedText sai, hai hàng hợp lệ vẫn duyệt. |
| Q09 | **1/1** | Ba hàng pending: đồng thời, keepalive, preventDefault/returnValue. |
| Q10 | **4/4** | Chuẩn/tùy chỉnh × có/không ảnh, quy tắc Phần 2 và ngày kế tiếp. |
| Q11 | **1/1** | Debounce mặc định + blur/flush, hai trường hoàn thành ngược thứ tự, reload/retry. |
| R3 network / stale toàn request | **2/2** | Lỗi kết nối giữ bản lỗi, thử lại được; staleIgnored giữ bản xung đột và chặn flush. |
| Native N01/N02/N03 | **4/4** | Nhập/blur/retry thật, hai nhánh sửa khi duyệt, dialog beforeunload thật. |
| R3-M01 / Native N04 | **0/2** | Cùng S3-08, hai cách thực thi độc lập; không tính thành hai finding. |

- **Nguồn chuẩn:** đã đối chiếu trạng thái/kế hoạch/changelog và cả hai vòng trước; không tự đánh dấu S3 được nghiệm thu.
- **Local/security:** dev/start còn bind `127.0.0.1`, route S3 kiểm tra `validateLocalRequest`; engine Zalo chung không nhập filesystem/DB/secret vào client; cấu hình đọc qua Path Allowlist. Không kích hoạt ngoại lệ Student Portal hoặc dùng credentials thật.
- **Playwright/checkpoint:** save-lms giữ hàng đợi đơn luồng; không thay browser manager/Persistent Context. Mã checkpoint và xác minh sau ghi không bị S3 sửa; các gate Chromium hồi quy đã chạy được. Không dùng `manage_task(Action:'send_input')` hoặc tương tác stdin.
- **Toàn vẹn/hash:** P11–P14 xác nhận chặn phiên bản cũ và hạ DRAFT/xóa hash sau sửa. S3-08 nằm ở chỗ xác nhận từng trường trước khi bản mới được server nhận; hash của nội dung đã lưu không chứng minh bản cục bộ đã được lưu.
- **AI/Zalo/SPCK:** engine chung, ngày kế tiếp, template tùy chỉnh và điều kiện Phần 2 đều có control đạt. Các suite guardrails/SPCK chạy với dữ liệu giả, mạng bị chặn; không chứng nhận OCR/AI hoặc nộp LMS thật. Quy tắc logo mặc định không bị S3 thay đổi.
- **Vai trò/giao tiếp:** Codex là auditor được chỉ định; không có lượt gọi Claude/Opus và không gán bằng chứng cho họ. Owner không cần chạy lệnh hoặc cung cấp thông tin đăng nhập cho lượt này.

## 6. Production Data Preservation Check

Lệnh duy nhất đọc nội dung hai tệp production, theo ngoại lệ Owner đã cho phép:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath 'data/mindx_bot.db', 'data/running_classes.json'
```

| Tệp | SHA-256 trước | SHA-256 sau | Đối chiếu kỳ vọng |
|---|---|---|---|
| `data/mindx_bot.db` | `28574C5708D04162B18D65746EC8788C456274E206542255206CE5084E446ED7` | `28574C5708D04162B18D65746EC8788C456274E206542255206CE5084E446ED7` | **UNCHANGED — MATCH** |
| `data/running_classes.json` | `ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2` | `ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2` | **UNCHANGED — MATCH** |

Không mở SQLite, sao chép, sửa hoặc xóa hai tệp trên. Đối chiếu thêm **2.287 tệp có sẵn**, bao gồm `src/**`, `scripts/**`, `docs/**`, `data/config/**`, `.agents/**`, các tệp gốc liên quan và `tsconfig.tsbuildinfo`: **không tệp nào đổi hash, kích thước hoặc thời gian ghi**. Phép đo gồm cả tệp chưa commit, toàn bộ bằng chứng S3 Round 1 và các thư mục audit lịch sử, không chỉ dựa vào `git diff`.

Scratch, DB/cache giả, mã probe và log chỉ nằm dưới TEMP. Bằng chứng quyết định đã được tổng hợp ngay trong báo cáo này theo yêu cầu không lưu thêm tệp audit. **Đã dọn toàn bộ thư mục audit TEMP bằng Node `fs.rmSync(target, {recursive:true, force:true})`, exit 0; kiểm tra sau xóa trả `auditTempDeleted:true`.** Trước xóa đã xác minh đường dẫn đích nằm trong Windows TEMP và không phải liên kết. Không dùng PowerShell xóa đệ quy, không tạo junction hoặc thư mục bằng chứng mới trong checkout.

## 7. Fingerprint nguồn được kiểm định

Các hash trước/sau trùng nhau; không áp dụng kết luận này cho cây mã đã đổi về sau.

| Tệp | SHA-256 |
|---|---|
| `src/lib/zalo/zalo-summary.ts` | `c260c785bc89aecdd7b4682b060eafe63aa21cc19ec1c9ac3bad2e5df6ad373c` |
| `src/lib/zalo/broadcast-generator.ts` | `57ac4e5e6dcea7f5dfdc683ccc260a017dade8a06d1a3c7b228ac06fe9c474b4` |
| `src/app/api/session-comments/zalo-btvn-image/route.ts` | `a0999ba3bfd2c0572c1b5d4436b0c8405c7f6786b9c17d203db86b39de26bb0c` |
| `src/app/api/session-comments/save-draft/route.ts` | `fc4390ce2078c6e5be660564c74d0412cb5290da08ec1909d796ebd273078bb5` |
| `src/app/api/session-comments/approve/route.ts` | `456eb64636add416ac0f89390e059bebfdb6e79b4caacf23912f3cc23f9fd65f` |
| `src/app/session-comments/page.tsx` | `9a0c41861348c24593fb7819679cae1733706ac9400ae5539e96c51e7c8c3d37` |
| `scripts/test-streamline-v340-s3.ts` | `df396bf165c50c674ea5459865c37580470d646d48031a27a46a473510e00d3d` |
| P gốc và bản sao đã chạy | `56d820c15020797635c437a310891fcc07480dc26f947ab036e6ac06d26257cf` |

## 8. Điều kiện GO vòng tiếp theo và giới hạn

1. Sửa **S3-08** ở hợp đồng xác nhận từng trường giữa save-draft và client, giữ được bản cục bộ bị từ chối và chặn hành động phụ thuộc.
2. Chạy lại R3-M01/N04 trên route/SQLite TEMP thật và Chromium; giữ các control đã đạt, đặc biệt HTTP/network hai trường, staleIgnored toàn request và payload save-lms hai nút.
3. Chạy lại 15 gate trên cây mã sau sửa, đối chiếu fingerprint và hai hash production bằng ngoại lệ chỉ đọc.

**Chưa kiểm tra:** LMS/Teaching/Gemini/Zalo thật, Next production build/dev server, mất điện/đóng cưỡng bức hoặc việc mọi keepalive đều được nhận nếu người dùng chọn rời trang. Native beforeunload đã kiểm tra chọn ở lại cùng dispatch đầy đủ; không biến kết quả đó thành cam kết chống mất dữ liệu tuyệt đối. Chưa nghiệm thu S4..S8 hoặc toàn bộ v3.4.0.

**Đã làm:** hoàn tất kiểm định Round 3 và ghi bằng chứng mới; không sửa sản phẩm. **Kết quả:** NO-GO vì S3-08 HIGH còn OPEN, dù 7 finding cũ đã đóng và 15 gate đều có lượt cuối PASS. **Việc tiếp theo:** bên triển khai sửa S3-08 và gửi lại kiểm định; Owner không cần thao tác kỹ thuật để hoàn tất báo cáo này.
