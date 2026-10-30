# Kiểm định độc lập v3.4.0 — S3, Round 2

**Decision: NO-GO cho Stage S3 Round 2.**

Ngày: **30/10/2026**. Đối tượng: cây làm việc so với **`ab3f570e57c908bf5d19e3df10a563efc45616f6`**, cũng là HEAD tại thời điểm kiểm định. Đây là kiểm định trực tiếp của Codex theo vai trò Owner yêu cầu; không gán kết quả cho Claude hoặc một reviewer khác.

**5/6 finding cũ CLOSED; S3-01 còn OPEN; thêm S3-07 HIGH.** Bộ dò Round 1 chạy lại nguyên assertions đạt **23/23 PASS**, nhưng bộ dò mở rộng Round 2 có **50 PASS / 4 FAIL trên 54 quan sát**. Bốn FAIL thuộc hai vấn đề: mất ghi chú khi các lần lưu chồng nhau và yêu cầu đẩy LMS thiếu `classCode`. **10/15 gate có lượt cuối exit 0; 5 gate còn exit 1 do môi trường chặn mở Chromium (`spawn EPERM`)**, chưa đủ bằng chứng nghiệm thu toàn bộ hồi quy.

Không sửa mã ứng dụng, test sẵn có, `next-env.d.ts`, cấu hình thật hoặc hồ sơ kiểm định cũ. Hai tệp dữ liệu thật chỉ được đọc bằng ngoại lệ `Get-FileHash` đã cho phép; không mở kết nối SQLite, sao chép, sửa hoặc xóa chúng. **2.281/2.281 tệp được đối chiếu giữ nguyên SHA-256.** Báo cáo này là tệp bàn giao mới duy nhất trong checkout.

## 1. Phạm vi và cách kiểm định

- Đọc `PROJECT_STATE.md` đầu tiên, đối chiếu Giai đoạn 10/S3 trong `MINDX_AUTOMATION_PLAN.md`, `CHANGELOG.md`, báo cáo `CODEX_S3_ROUND1.md` và `AGENTS.md`. Tài liệu vẫn để S3 chờ nghiệm thu.
- Đọc diff với `ab3f570` và các bên nối liên quan: component `/session-comments`, route lưu nháp/duyệt/đẩy LMS/danh sách/xử lý ảnh BTVN, SQLite, bộ tạo Zalo/cấu hình, hàng đợi, bộ ghi LMS và kiểm tra yêu cầu nội bộ. Đối chiếu hướng dẫn Route Handlers trong bản Next.js đã cài.
- Dùng phương pháp `ponytail`/`ponytail-review`: lần theo dữ liệu từ bên gọi đến bên nhận, báo lỗi có tình huống tái hiện. Giả định một giáo viên dùng ứng dụng nội bộ; giáo viên có thể tiếp tục nhập khi mạng chậm và các phản hồi có thể đến ngược thứ tự.
- Toàn bộ test chạy trong bản sao TEMP, dùng mã nguồn/test hiện tại và thư viện đã cài tại checkout. Chỉ sao chép `src`, `scripts`, tài liệu, skills, `data/config` và các tệp gốc phục vụ test; **không sao chép DB, cache lớp thật, `.env*`, hoặc `playwright-auth`**. Hai script khởi động chỉ được sao chép để đọc, không chạy.
- Trước từng lần thực thi, đặt `ALLOWED_LOCAL_DIRS`, `MINDX_DB_PATH`, `MINDX_RUNNING_CLASSES_PATH` vào TEMP. `TEMP`/`TMP` của tiến trình con cũng nằm trong thư mục thử để gom các thư mục phụ do suite tự tạo. `test-quick-tags-v300.ts` được cấp override từ runner, không dựa vào việc script tự đặt. Các suite tự thay override vẫn chỉ thao tác trong bản sao TEMP.
- Loader dùng `@next/swc-win32-x64-msvc`, `require.extensions['.ts' / '.tsx']` và `Module._resolveFilename`; alias `@/` trỏ vào bản sao, package trỏ vào `node_modules` của checkout. **Không tạo junction `node_modules`.** Đây là cách chạy được Owner cho phép làm gate chính thức. Không thay assertions hay mã nguồn/test của bản sao.
- Chặn kết nối TCP ra ngoài trước khi nạp suite; có chốt từ chối đọc/mở hai đường dẫn dữ liệu production trong loader. Không dùng khóa thật. Các ca AI cần nhánh cấu hình có khóa được chạy với `AUDIT_SYNTHETIC_NO_NETWORK` và model do test giả lập.
- Component probe thực thi các handler thật trong VM (môi trường chạy JavaScript có điều khiển), route thật và SQLite TEMP thật. Hook React, độ trễ/lỗi mạng, Gemini và kết quả dịch vụ ngoài được giả lập có chủ đích. Probe S3-07 nối component với **route save-lms thật**, chỉ thay hàm xếp hàng bằng kết quả giả an toàn; route từ chối trước khi xếp hàng.
- Không cập nhật ba tài liệu trạng thái/kế hoạch/changelog: lượt này chỉ tạo báo cáo kiểm định, không sửa sản phẩm hay công nhận S3 hoàn tất. Giữ nguyên các tài liệu theo yêu cầu cô lập cụ thể của lượt audit.

## 2. Gate Execution Summary

Ký hiệu thực thi:

```text
SWC = node <TEMP>/loader.cjs <TEMP>/workspace/scripts/<suite>.ts
SWC-UI = node <TEMP>/loader-ui-swc.cjs <TEMP>/workspace/scripts/<suite>.ts
TSC trực tiếp = node <checkout>/node_modules/typescript/lib/tsc.js --noEmit --incremental false
```

`SWC-UI` giữ nguyên suite và assertions; ngoài nạp TypeScript bằng SWC, nó dùng SWC để chuyển JSX bên trong UI probe thay lời gọi `esbuild.transformSync` vốn cần tiến trình bị chặn. Cấu hình JSX classic tương ứng `jsx: 'transform'`. Đây là kiểm định hành vi VM bằng trình biên dịch thay thế, không phải kiểm định trình duyệt.

### Các gate bắt buộc và exit code thực tế

| Lệnh yêu cầu | Cách thực thi | Exit đầu → cuối | Kết quả/giới hạn |
|---|---|---:|---|
| `npx tsc --noEmit --incremental false` | TSC trực tiếp; chạy thêm `npx --no-install tsc --noEmit --incremental false` | **0; 0** | PASS; không ghi tệp build tăng dần. |
| `npx tsx scripts/test-streamline-v340-s3.ts` | SWC | **0** | Suite S3 chạy mới đủ các phần, gồm section 6. |
| `npx tsx scripts/test-quick-tags-v300.ts` | SWC | **0** | PASS trên DB TEMP. |
| `npx tsx scripts/test-streamline-v340-s1.ts` | SWC | **0** | PASS. |
| `npx tsx scripts/test-streamline-v340-s2.ts` | SWC | **0** | PASS. |
| `npx tsx scripts/test-phase5.ts` | SWC | **0** | PASS. |
| `npx tsx scripts/test-phase6.ts` | SWC | **1** | Dừng tại `chromium.launch`, `spawn EPERM`; chưa qua toàn suite. |
| `npx tsx scripts/test-phase7.ts` | SWC, bản sao TEMP | **1 → 0** | Lượt đầu thiếu hai script khởi động trong mirror; bổ sung bản sao rồi chạy nguyên suite đạt. |
| `npx tsx scripts/test-phase4-codex-repros.ts` | SWC | **0** | PASS. |
| `npx tsx scripts/test-spck-v270.ts` | SWC | **1 → 0** | Lượt đầu thiếu khóa AI giả; chạy lại với khóa giả đạt T01–T16. |
| `npx tsx scripts/test-spck-v272.ts` | SWC | **1** | V01 dừng tại `browserType.launch: spawn EPERM`. |
| `npx tsx scripts/test-lms-reliability-v280.ts` | SWC | **1** | Dừng tại `browserType.launch: spawn EPERM`. |
| `npx tsx scripts/test-session14-v290.ts` | SWC | **1 → 1** | Lượt đầu thiếu khóa AI giả. Lượt sau S14-01..S14-05 PASS, dừng ở S14-06 do Chromium `spawn EPERM`. |
| `npx tsx scripts/test-teaching-project-v320.ts` | SWC | **1** | Dừng tại `browserType.launch: spawn EPERM`. |
| `npx tsx scripts/test-report-card-v330.ts` | SWC → SWC-UI | **1 → 0** | RC-01..RC-05 đạt ở lượt đầu, RC-06 bị esbuild `spawn EPERM`. Lượt SWC-UI chạy đủ RC-01..RC-06 đạt. |

Không coi lỗi thiếu fixture/khóa giả ở lượt đầu là lỗi sản phẩm. Không coi năm gate bị chặn trình duyệt là PASS. Không suy ra kết quả Round 2 từ các gate PASS trong hồ sơ Round 1. Wrapper chạy nhiều suite có thể exit 0 khi đã thu thập đủ kết quả; bảng dùng **exit của từng tiến trình suite**, không dùng exit của wrapper thay thế.

### Probe độc lập và các lượt bổ sung

| Lệnh đã thực thi | Exit code | Kết quả |
|---|---:|---|
| `node <TEMP>/loader.cjs <TEMP>/adversarial.cjs` | **0** | Bản sao nguyên `docs/audits/v340/s3-round1/adversarial.cjs`, **23 PASS / 0 FAIL**. P15 chạy hai trạng thái nên P01..P22 có 23 kết quả. |
| `node <TEMP>/loader.cjs <TEMP>/extra.cjs` | **1** | **50 PASS / 3 FAIL**; Q01 batch/single và Q03 thất bại. |
| `node <TEMP>/loader.cjs <TEMP>/blur.cjs` | **1** | Q11 thất bại: tái hiện mất ghi chú với debounce mặc định và flush do rời ô nhập, không dùng tùy chọn lưu ngay. |
| Đối chiếu SHA-256 2.281 tệp được bảo vệ bằng Node | **0** | Không tệp nào đổi hoặc mất; fingerprint nguồn ở mục 7. |
| `Get-FileHash -Algorithm SHA256 -LiteralPath 'data/mindx_bot.db', 'data/running_classes.json'` trước và sau | **0; 0** | Hai hash giữ nguyên, khớp giá trị Owner cung cấp. |
| `node -e` dọn scratch bằng `fs.rmSync` và kiểm tra không còn tồn tại | **0** | `auditTempDeleted:true`, `helperFilesDeleted:true`; kiểm tra đường dẫn nằm đúng trong TEMP trước khi xóa. |

Các lệnh đọc tài liệu, `rg`, `git status`, `git diff` và chuẩn bị bản sao là thao tác điều tra, không phải gate nghiệm thu. Các lần tìm kiếm sai cú pháp wildcard PowerShell đã được đọc/tìm lại theo đường dẫn đúng; không tính thành finding ứng dụng. Không chạy build/dev server, không cài thư viện và không thay quyền hệ thống để vượt `EPERM`.

## 3. Finding Table

Số dòng dưới đây thuộc cây nguồn đã kiểm định, không phải số dòng của baseline hoặc Round 1.

| ID | Severity | Status | Vị trí chính xác | Bằng chứng tái hiện | Required fix / căn cứ đóng |
|---|---|---|---|---|---|
| **S3-01** | **HIGH** | **OPEN** | `src/app/session-comments/page.tsx:1651`, `:1761`, `:1775`, `:1800`, `:1219`, `:657` | P03–P06 đã PASS: lỗi lưu đơn lẻ chặn AI/duyệt/đẩy. Nhưng Q03 và Q11: lưu ghi chú A đang chờ, lưu nhận xét B của cùng học viên thành công trước, A trả HTTP 500 sau. A bị coi là phản hồi cũ nên không được ghi nhận là chưa lưu; chỉ promise mới nhất được theo dõi theo học viên. `flushAllPendingDraftSaves()` trả **true**, DB còn `ORIGINAL NOTE`, UI còn ghi chú mới và `unsaved=[]`. Tải lại ngay cả với `preserveLocalUnsavedEdits:true` làm ghi chú mới mất khỏi UI. | Theo dõi phần chưa lưu theo từng trường hoặc giữ đủ các lần lưu đang chờ. Chỉ bỏ phản hồi thất bại khi các trường của nó thực sự đã được một lần lưu mới hơn xác nhận; không dùng một số phiên bản toàn hàng để bỏ lỗi của trường khác. Flush phải đợi/đánh giá đủ và giữ bản lỗi để thử lại; reload phải còn nhận ra bản chưa lưu. Thêm test hai trường, phản hồi ngược thứ tự, cả lỗi HTTP và lỗi kết nối. |
| **S3-02** | **HIGH** | **CLOSED** | `src/app/session-comments/page.tsx:2463`, `:2644`, `:2704`, `:2903`, `:657` | P17: sửa khi duyệt cả lớp → **không gửi `/save-lms`**, DB là DRAFT chứa chữ mới, hash rỗng, UI giữ chữ mới. Q02 kiểm tra cả lớp/từng dòng, cả khi lưu bản sửa thành công và thất bại; đều chặn đẩy và giữ nội dung mới. Q04 giữ bản lỗi qua reload bảo toàn. | Đã chặn hành động gộp khi phát hiện sửa đồng thời; phục hồi nháp và bảo toàn bản sửa chưa lưu. Khi cố ý ép lưu thất bại thì DB có thể vẫn APPROVED cũ, nhưng request đẩy trong luồng này bị chặn và UI giữ bản mới để thử lại. Không tuyên bố DB được hạ trạng thái thành công khi request ghi DB thất bại. Lỗi theo dõi chéo trường còn lại được tính ở S3-01. |
| **S3-03** | **HIGH** | **CLOSED** | `src/app/session-comments/page.tsx:1251`, `:1260`, `:1627` | P07/P08: hai request được phát đồng thời trước khi trả bất kỳ phản hồi nào, cả hai `keepalive:true`. Q09: ba hàng đồng thời, đều keepalive; sự kiện có gọi `preventDefault()` và đặt `returnValue=''`. | Đã sửa lỗi dispatch tuần tự/thiếu keepalive của R1 và thêm yêu cầu cảnh báo rời trang. Có nhánh giới hạn kích thước, không gắn keepalive vô điều kiện. Đóng finding về thiết kế handler đã tái hiện ở R1; **chưa xác minh hộp thoại/đóng tab thật hoặc bảo đảm mọi dữ liệu đều đến máy chủ sau khi người dùng chọn rời trang**, vì Chromium bị chặn. |
| **S3-04** | **MEDIUM** | **CLOSED** | `src/app/api/session-comments/save-draft/route.ts:159`, `:184`, `:203`, `:487` | P10: hợp lệ A / `teacherNote` object ở B / hợp lệ C → HTTP **400**, `savedCount:2`, `failedCount:1`, đủ ba results, A và C được lưu. Q05 chạy 28 tổ hợp sai kiểu trên bảy trường; đều báo đúng từng hàng. Q06 cố ý ném lỗi repository tại B ở cả save và approve; vẫn trả đủ kết quả và xử lý C. | Kiểm tra kiểu trước khi ghi và bắt ngoại lệ từng item đã có hiệu lực. Ngoại lệ repository thật có thể vẫn làm endpoint approve trả HTTP 500, nhưng có đủ kết quả từng item; đây khác lỗi dữ liệu sai kiểu và không còn che giấu các hàng đã ghi. |
| **S3-05** | **MEDIUM** | **CLOSED** | `src/app/api/session-comments/approve/route.ts:76`, `:101`, `:328` | P15: DB `INSUFFICIENT_INFO`/`FAILED`, bỏ trường status → HTTP **400**, trạng thái giữ nguyên. Q07: cả bỏ status và giả `DRAFT`/`APPROVED` đều bị chặn; Q08: approvedText object/array/boolean/number bị từ chối, hai hàng hợp lệ hai bên vẫn duyệt được. | Route đã đọc và kiểm tra trạng thái DB trước duyệt, không chỉ tin status bên gọi; kiểu nội dung và ngoại lệ batch được kiểm tra. Phạm vi là ứng dụng nội bộ với luồng SQLite đồng bộ hiện có, không chứng nhận nhiều tiến trình độc lập cùng ghi DB. |
| **S3-06** | **LOW** | **CLOSED** | `src/lib/zalo/broadcast-generator.ts:167`, `:171`, `:187`; `src/lib/zalo/zalo-summary.ts:188` | P16: lưu `OWNER_CUSTOM {{className}}` tại chính ID chuẩn → kết quả **`OWNER_CUSTOM AUDIT`**. Q10: mẫu chuẩn/tùy chỉnh × có/không ảnh BTVN đều giữ mẫu và chỉ có Phần 2 khi có ảnh. | Nhánh mẫu chuẩn chưa sửa dùng engine chung; mẫu đã tùy chỉnh quay lại render mẫu đã lưu. Không sửa cấu hình thật trong kiểm định. |
| **S3-07** | **HIGH** | **OPEN** | `src/app/session-comments/page.tsx:2810`, `:2814`; bên nhận `src/app/api/session-comments/save-lms/route.ts:15` | Q01 batch và single nối handler UI với route thật: payload chứa `classId`, `sessionId`, các nội dung buổi học nhưng **không có `classCode`**. Cả hai trả HTTP **400**, `success:false`, `error:'Thiếu classId, classCode hoặc sessionId.'`; UI báo lưu thất bại. `normalizedClassCode` đã tính nhưng không đưa vào JSON. `git diff ab3f570` xác nhận dòng `classCode: normalizedClassCode` đã bị xóa. | Khôi phục `classCode: normalizedClassCode` trong payload dùng chung của `handleSaveToLms`. Thêm test nối payload của cả hai nút với route thật, chỉ giả lập tác vụ ngoài sau hàng đợi. Hiện test tại `scripts/test-streamline-v340-s3.ts:392` trả thành công giả cho mọi `/save-lms`, nên không phát hiện thiếu trường bắt buộc. |

### Xuất xứ và tác động

- **S3-01 chưa đóng hoàn toàn:** bốn repro đơn lẻ R1 đã được sửa, nhưng yêu cầu không bỏ sót lỗi lưu và giữ bản chưa lưu vẫn thất bại khi hai trường cùng hàng được lưu chồng nhau. Guard bỏ phản hồi cũ đã có trong baseline; không khẳng định toàn bộ tình huống là lỗi mới do S3 tạo ra. Đây là phần chưa được bản sửa R2 xử lý đầy đủ. Mất ghi chú đã được quan sát trên dữ liệu giả, không tuyên bố dữ liệu Owner từng bị mất.
- **S3-07 là hồi quy mới so với baseline:** mọi nút hiện dùng `handleSaveToLms` sẽ gửi thiếu cùng trường. Thao tác duyệt có thể hoàn tất trong SQLite nhưng phần đẩy LMS bị từ chối ngay tại route. Không cần đăng nhập LMS hoặc thay dữ liệu thật để chứng minh.
- Trường hợp Q02 ép lưu phục hồi thất bại vẫn báo câu “Đã lưu lại bản nháp mới nhất” ở luồng cả lớp dù DB chưa nhận được bản mới. Quan sát này được ghi rõ để tránh hiểu quá mức kết quả đóng S3-02; khi sửa S3-01 cần giữ thông báo lỗi lưu và phân biệt “đã lưu” với “đang giữ trên màn hình”. Chưa tạo ID riêng cho cùng nhánh phục hồi.

## 4. Bằng chứng đối kháng

### Chạy lại P01..P22, giữ nguyên assertions

| Probe | Kết quả Round 2 |
|---|---|
| P01/P02 | PASS: gõ liên tiếp không gửi sớm; flush lưu đúng chữ cuối. |
| P03/P04/P05/P06 | PASS: ép lỗi lưu chặn AI, gộp cả lớp, gộp từng dòng và duyệt nháp. |
| P07/P08 | PASS: dispatch đủ hai hàng đồng thời và keepalive. |
| P09/P10 | PASS: lỗi validation/kiểu dữ liệu từng hàng có kết quả đầy đủ, không mất hàng thành công. |
| P11/P12 | PASS: chặn lưu phiên bản cũ và duyệt phiên bản cũ với HTTP 409. |
| P13/P14 | PASS: hash duyệt đúng, sửa lại hạ DRAFT và bỏ hash. |
| P15 × 2 | PASS: không bỏ qua trạng thái INSUFFICIENT_INFO/FAILED trong DB. |
| P16 | PASS: giữ mẫu chuẩn đã tùy chỉnh. |
| P17 | PASS: sửa khi đang duyệt không dẫn tới request đẩy bản cũ. |
| P18/P19/P20 | PASS: đường thuận dùng đúng bản mới sau flush trước AI/duyệt. |
| P21/P22 | PASS: phản hồi ngược thứ tự cùng trường giữ bản mới; xác nhận UNKNOWN không đổi người ABSENT. |

### Probe Round 2 bổ sung

| Nhóm | Số quan sát PASS / tổng | Nội dung |
|---|---:|---|
| Q01 | **0/2** | UI cả lớp/từng dòng → route save-lms thật: thiếu mã lớp. |
| Q02 | **4/4** | Sửa lúc duyệt, cả hai nút × lưu phục hồi thành công/thất bại: chặn đẩy và giữ bản mới. |
| Q03 | **0/1** | Ghi chú lưu lỗi sau khi trường nhận xét lưu thành công: lỗi bị quên. |
| Q04 | **1/1** | Reload giữ bản sửa khi lỗi đã được đánh dấu đúng. |
| Q05 | **28/28** | Bảy trường × bốn kiểu sai, bảo toàn hàng hợp lệ đứng sau hàng lỗi. |
| Q06 | **2/2** | Ngoại lệ repository ở giữa batch save/approve. |
| Q07 | **6/6** | Hai trạng thái DB bị cấm × ba cách bỏ/giả status bên gọi. |
| Q08 | **4/4** | Bốn kiểu approvedText sai, bảo toàn hai hàng hợp lệ. |
| Q09 | **1/1** | Ba hàng khi rời trang: phát đồng thời, keepalive, tín hiệu cảnh báo. |
| Q10 | **4/4** | Mẫu chuẩn/tùy chỉnh và quy tắc chỉ thêm Phần 2 khi có ảnh. |
| Q11 | **0/1** | Xác nhận Q03 bằng debounce mặc định + flush khi rời ô nhập + reload. |
| **Tổng Round 2 bổ sung** | **50/54** | Bốn FAIL thuộc **S3-01 và S3-07**, không phải bốn lỗi riêng. |

### Trích kết quả thực thi Q01

```json
{
  "probe": "Q01-batch-page-real-route-accepts-payload",
  "http": 400,
  "payloadIdentifiers": {
    "classId": "AUDIT-S3-1",
    "sessionId": "AUDIT-S3-1_SESS_01"
  },
  "classCodePresent": false,
  "response": {
    "success": false,
    "error": "Thiếu classId, classCode hoặc sessionId."
  },
  "uiMessage": "Lưu thất bại: Thiếu classId, classCode hoặc sessionId."
}
```

Luồng single cho cùng HTTP/lỗi, có thêm `studentId:'S0'`. Payload thực thi còn chứa topic, keyKnowledge và homeworkBrief; không trường nào trong số này bổ sung được mã lớp bắt buộc.

### Trích kết quả thực thi Q11

```json
{
  "probe": "Q11-default-debounce-blur-failed-note-not-lost",
  "flush": true,
  "dbNote": "ORIGINAL NOTE",
  "uiBeforeReload": "NOTE LOST AFTER BLUR",
  "uiAfterReload": "ORIGINAL NOTE",
  "unsaved": []
}
```

Trình tự tái hiện có thể lặp lại trong harness R1 với mã hiện tại:

1. Tạo học viên giả S0, có `teacherNote:'ORIGINAL NOTE'`, `finalText:'ORIGINAL TEXT'`, PRESENT/DRAFT. Giữ hai fetch lưu nháp chờ bằng `holdDraft`.
2. Gọi `handleNoteChange('S0', 'NOTE LOST AFTER BLUR')` không truyền tùy chọn lưu ngay; render rồi gọi `flushPendingDraftSave('S0')` để mô phỏng rời ô ghi chú. Request A chứa ghi chú mới và `finalText:'ORIGINAL TEXT'`.
3. Trong lúc A đang chờ, gọi `handleTextEdit('S0', 'finalText', 'TEXT SAVED AFTER BLUR')`; render rồi flush S0. Request B chứa các trường nhận xét và chữ mới, **không chứa teacherNote**.
4. Cho B chạy qua route thật/SQLite TEMP thành công trước. Sau đó cho A nhận HTTP 500 bằng `failDraft`; chờ cả hai hoàn tất. Không sửa DB hoặc metadata thủ công trong ca này.
5. Bỏ lỗi giả, gọi `flushAllPendingDraftSaves()`: trả true dù DB còn ghi chú cũ. Gọi `loadClassData(classId, sessionId, {preserveLocalUnsavedEdits:true})`: UI đổi từ ghi chú mới sang ghi chú cũ.

Q03 dùng tùy chọn `immediate:true` để kiểm tra cùng lỗi theo đường lưu ngay; Q11 xác nhận lỗi xảy ra với cách nhập/rời ô của giao diện hiện tại. P21 chỉ kiểm tra hai lần lưu **cùng trường** thành công, vì vậy vẫn PASS mà không phủ được lỗi khác trường này.

Các harness Round 2 dựng trong TEMP từ phần khai báo/harness của R1, mở thêm các ref cần quan sát trong API VM. Mã component/route/repository không được chỉnh sửa. Q01 chuyển riêng fetch `/save-lms` sang POST của route thật; Q06 chỉ thay phương thức repository trong bộ nhớ để ném ngoại lệ có kiểm soát. Kết quả/gate quan trọng được chép vào báo cáo này trước khi xóa scratch; không có liên kết bằng chứng tới tệp TEMP đã xóa.

## 5. Đối chiếu sáu quy tắc dự án và giới hạn

| Quy tắc | Kết quả trong phạm vi lượt này |
|---|---|
| Nguồn trạng thái chuẩn | Đã đọc/đối chiếu ba tài liệu và hồ sơ Round 1. Không tự đánh dấu S3 hoàn tất. |
| Chạy nội bộ / bí mật / Path Allowlist | Dev/start vẫn bind `127.0.0.1`. Route S3 vẫn kiểm tra yêu cầu nội bộ. Engine Zalo chung không kéo filesystem, DB hoặc secret server vào client. Cấu hình đọc qua `json-config` và Path Allowlist. Không mở Student Portal/tunnel, không đụng khóa/tài khoản thật. |
| Playwright / checkpoint / xác minh sau ghi | Route save-lms giữ hàng đợi đơn luồng; browser manager giữ Persistent Context `playwright-auth`. Không thay mã chọn ô nhận xét chung ở checkpoint hoặc mã kiểm tra phản hồi/đọc lại trước VERIFIED. **Các gate cần Chromium chưa hoàn tất trong phiên này; không chứng nhận lại toàn bộ cơ chế LMS chỉ từ đọc nguồn.** |
| Khóa dữ liệu / hash | P11–P14 chạy thật trên SQLite TEMP và đạt. S3-01 nằm ở bản chưa được DB xác nhận; hash của bản đã lưu không bảo vệ được phần nội dung bị quên trên UI. |
| AI / Zalo / SPCK | Không gọi Gemini thật. Suite S3 và Q10 kiểm tra cấu trúc Zalo/ngày kế tiếp/mẫu tùy chỉnh/Phần 2. Quick Tags, Phase 4/5, v270 và report-card đạt trong môi trường giả. Quy tắc logo mặc định không bị S3 sửa. Không chứng nhận ảnh thật, độ chính xác OCR, ẩn danh mọi ảnh BTVN hoặc toàn bộ SPCK/LMS native vì chưa chạy được mọi gate. |
| Quy trình đội ngũ / giao tiếp | Codex thực hiện lượt kiểm định độc lập được Owner chỉ định; Claude/Opus không có trong các model/công cụ khả dụng, không giả nhận đã có họ review. Không dùng `manage_task(Action:'send_input')`, không gửi stdin để tương tác với tác vụ treo. Không cần Owner thao tác kỹ thuật. |

Không gửi tin Zalo, không đăng nhập tài khoản thật, không ghi LMS/Teaching thật. Không có bằng chứng dữ liệu production bị lỗi từ những ca giả lập này. Việc sửa hai finding rồi chạy lại probe là cần thiết; vẫn phải hoàn tất năm gate bị chặn và thử native rời trang/sửa trong khi duyệt trước khi công nhận toàn bộ nghiệm thu yêu cầu.

## 6. Production Data Preservation Check

Lệnh duy nhất dùng để đọc hai tệp dữ liệu production:

```powershell
Get-FileHash -Algorithm SHA256 -LiteralPath 'data/mindx_bot.db', 'data/running_classes.json'
```

| Tệp | SHA-256 trước | SHA-256 sau | Kết quả |
|---|---|---|---|
| `data/mindx_bot.db` | `28574C5708D04162B18D65746EC8788C456274E206542255206CE5084E446ED7` | `28574C5708D04162B18D65746EC8788C456274E206542255206CE5084E446ED7` | **UNCHANGED — MATCH** |
| `data/running_classes.json` | `ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2` | `ADBEE2357251FCDC56DF07CAA866015BF1E75C7247439D7F7E2C2B2D78DE63E2` | **UNCHANGED — MATCH** |

Đối chiếu thêm **2.281 tệp có sẵn**: `src/**`, `scripts/**`, `docs/**` (bao gồm round-12..round-41 và toàn bộ R1), `data/config/**`, `.agents/**`, `next-env.d.ts`, ba tài liệu trạng thái và `tsconfig.tsbuildinfo`; không có tệp bị đổi hoặc mất. Không dùng so sánh Git để bỏ qua tệp chưa được theo dõi: phép đối chiếu bao gồm các tệp có sẵn chưa commit.

Scratch, log, DB/cache giả và bản sao workspace chỉ nằm trong TEMP. Dọn bằng Node `fs.rmSync(target, {recursive:true, force:true})` sau khi kiểm tra target thuộc đúng TEMP và tổng hợp bằng chứng vào báo cáo. Không dùng `Remove-Item -Recurse -Force`; không tạo thư mục bằng chứng mới dưới `docs/audits/v340/`.

**Đã dọn xong và xác minh:** thư mục audit TEMP cùng bốn tệp điều phối tạm đã được xóa; Node trả `auditTempDeleted:true`, `helperFilesDeleted:true`, exit **0**.

## 7. Fingerprint nguồn đã kiểm định

Các giá trị trước/sau giống nhau. Kết luận chỉ áp dụng cho snapshot này, không dùng cho mã đã thay đổi về sau.

| Tệp | SHA-256 |
|---|---|
| `src/lib/zalo/zalo-summary.ts` | `c260c785bc89aecdd7b4682b060eafe63aa21cc19ec1c9ac3bad2e5df6ad373c` |
| `src/lib/zalo/broadcast-generator.ts` | `57ac4e5e6dcea7f5dfdc683ccc260a017dade8a06d1a3c7b228ac06fe9c474b4` |
| `src/app/api/session-comments/zalo-btvn-image/route.ts` | `a0999ba3bfd2c0572c1b5d4436b0c8405c7f6786b9c17d203db86b39de26bb0c` |
| `src/app/api/session-comments/save-draft/route.ts` | `fc4390ce2078c6e5be660564c74d0412cb5290da08ec1909d796ebd273078bb5` |
| `src/app/api/session-comments/approve/route.ts` | `456eb64636add416ac0f89390e059bebfdb6e79b4caacf23912f3cc23f9fd65f` |
| `src/app/session-comments/page.tsx` | `2c19f7bda2a342d9d9a9dddcbc97a9e8d27a786d27b2cbb8d8653504a2fb363b` |
| `scripts/test-streamline-v340-s3.ts` | `c95a9227aa320212997d02026402ae255d77ed5d3de90adb7a934d1709fc9417` |

## 8. Điều kiện vòng tiếp theo

1. **S3-07:** khôi phục mã lớp trong payload dùng chung; nối test hai nút với route save-lms thật và chỉ giả lập bước tác động bên ngoài.
2. **S3-01:** bảo toàn lỗi lưu theo những trường chưa được xác nhận khi các request cùng học viên chồng nhau; flush không được báo thành công khi ghi chú vẫn chưa lưu; không làm mất ghi chú khi reload. Giữ bản mới trên màn hình và thông báo đúng nếu lưu phục hồi thất bại.
3. Chạy lại nguyên P01..P22 và các ca Q01/Q03/Q11 với mã mới. Giữ các control về phiên bản, hash, partial batch, sửa trong khi duyệt, mẫu tùy chỉnh và rời trang.
4. Chạy đủ 15 gate trong môi trường cho phép Chromium, với dữ liệu TEMP và transport giả; hoàn tất cả native browser cho rời trang và sửa trong lúc duyệt. Không yêu cầu thử trên dữ liệu Owner để đóng hai lỗi đã tái hiện cục bộ.
5. Chốt fingerprint nguồn mới và kiểm tra trước/sau hai hash production bằng đúng ngoại lệ chỉ đọc.

**Kết luận: NO-GO. Lượt audit hoàn tất, sản phẩm chưa đủ điều kiện nghiệm thu S3; không tự triển khai các bản sửa trong lượt kiểm định này.**
