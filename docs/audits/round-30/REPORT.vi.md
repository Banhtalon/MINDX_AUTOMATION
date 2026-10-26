# AUDIT-R30 — Kiểm toán độc lập Giai đoạn 5

**Phán quyết: NO-GO cấp mã nguồn; 13/14 nhóm CLOSED_SOURCE, còn R19-01 P2.**

Đóng đủ **8/8 ca lỗi R29**; các cổng R29 nguyên bản đạt **815/815, 217/217, 88/88**. R30 giữ nguyên 815 ca đó và thêm bốn ca độc lập, đạt **817/819**; native media **219/221**, native worker **88/88**. Hai ca trượt mới là PDF hợp lệ chứa tên rỗng trong mảng hoặc từ điển con bị từ chối. Nguồn R29 đúng hash nhận chúng; pypdf strict và bộ đọc byte độc lập xác nhận hợp lệ. [Kết quả](evidence/verify-results.json), [đóng lỗi R29](evidence/r29-fix-closure.json), [lỗi mới](evidence/new-findings.json).

Đánh dấu [x] hoàn tất kiểm toán R30; mục **nghiệm thu sau R30 giữ [ ]** vì chưa đạt 14/14 CLOSED_SOURCE / GO. Chưa nghiệm thu vận hành trên tài khoản, bài nộp hoặc LMS/Gemini thật. Giữ nguyên các mục R28/R29 như lịch sử.

## 1. Nguồn được kiểm và phạm vi

- Ngày kiểm toán: **21/10/2026**, giờ Việt Nam; chụp nguồn lúc `2026-10-20T20:57:49.997846+00:00` UTC.
- HEAD: `2570d96b6770957e218031c91f14ce98e766dfa7`. Workspace có nhiều thay đổi chưa commit từ trước; không reset, commit, phục hồi đè hoặc sửa sản phẩm. [Trạng thái đầu](evidence/source-state.json).
- Danh mục **74 file**, gồm **57 src/scripts**; SHA-256 tổng hợp `a62eb62d8adc74d0c47d78aaa0905b9fb90ab474d864058720727bfcf821e2de`. [Danh mục nguồn](evidence/source-manifest.json).
- So với nguồn ghi trong R29, **chỉ `src/lib/file-parsers/media-reader.ts` đổi trong src/scripts**; khác biệt tài liệu là kế hoạch. `grade-worker.ts` giữ nguyên. [Đối chiếu](evidence/changes-since-r29.json), [diff nguồn](evidence/media-reader.since-r29.diff).
- SHA-256 `media-reader.ts`: `3d677823077a3c7eb36f7261f45970ca7b7903e9797b1568ce602f86109760ac`.
- SHA-256 `grade-worker.ts`: `f5db4a78fcdd2b2022a6c663444e0f6c24acfc6600da884cd5b62a75fef33d73`.

Đã đối chiếu AGENTS.md, TASK-5.1–5.5 và điều kiện nghiệm thu, REPORT/FIX_PROMPT R29; rà bản sửa PDF cùng các rào liên quan tới đường dẫn file, barem/tổng điểm, hash bản duyệt, đúng định danh, đúng API lưu, đọc lại và cập nhật VERIFIED. Tải dự kiến: một giáo viên dùng cục bộ, thao tác trình duyệt nối tiếp; phản hồi AI/nháp/giao diện có thể về sai thứ tự. Đây là kiểm toán Giai đoạn 5 cùng các cổng hồi quy yêu cầu, không phải kiểm thâm nhập toàn bộ dự án. [Rà nguồn](evidence/static-review.json).

## 2. Cô lập và bảo toàn

Bản sao chính có đủ tiền tố tương thích R22–R30:

```text
C:\Users\QQ\AppData\Local\Temp\mindx-round30-20261020T205749Z-mindx-round29-compat-mindx-round28-compat-mindx-round27-compat-mindx-round26-compat-mindx-round25-compat-mindx-round24-compat-mindx-round23-compat-mindx-round22-compat\snapshot
```

Bản sao phụ R20/R21:

```text
C:\Users\QQ\AppData\Local\Temp\mindx-round30-history-20261020T205749Z-mindx-round20-compat-mindx-round21-compat\snapshot
```

Bản sao ngắn cho R25 native worker, Phase 4/5 và oracle PDF:

```text
C:\Users\QQ\AppData\Local\Temp\mindx-round30-native25-20261020T205749Z-mindx-round25-compat\snapshot
```

Toàn bộ lần thực thi sản phẩm, SQLite giả, TypeScript và build đều trong TEMP. Thư viện được sao chép vật lý; không nối junction về workspace. Không sao chép `.env`, `.env.local`, `.git`, hồ sơ đăng nhập, DB hay bài nộp thật. Tiến trình dùng môi trường lọc và rào Node chặn TCP/DNS/fetch, cho phép named pipe nội bộ. Không mở server/trình duyệt hoặc gọi LMS/Gemini thật. Rào Node là biện pháp của bộ kiểm, không phải tường lửa hệ điều hành. [Cô lập](evidence/isolation.json), [bản sao lịch sử](evidence/secondary-snapshot.json), [bản sao ngắn](evidence/sqlite-snapshot.json).

Runner kế thừa R29, giữ `ESBUILD_BINARY_PATH` trỏ tới bản sao `esbuild.exe` cùng SHA-256 ở đường dẫn TEMP ngắn. [Bằng chứng](evidence/esbuild-path-workaround.json). Thêm một tiền tố R29 làm đường dẫn dài hơn: lần đầu native25-worker, Phase 4/5 gặp `SQLITE_CANTOPEN`; oracle PDF gặp `ModuleNotFoundError` khi Python tìm module dưới đường dẫn dài. Bốn cổng chạy lại trong bản sao vật lý ngắn hơn và đạt; không sửa sản phẩm, thư viện hoặc bộ kiểm cũ. Đủ cả bốn log thất bại đầu được giữ. [Ghi chú](evidence/harness-development-notes.md).

Trong tập kiểm **1128 file** ngoài R30, chỉ cho phép chèn mục R30 vào kế hoạch. **1051/1051 file bảo vệ**, gồm `next-env.d.ts` và toàn bộ R12–R29, cùng **57/57 src/scripts** giữ nguyên từng byte. Không thay checkbox TASK-5.x hoặc mục nghiệm thu cũ. Không thay INDEX/LATEST ngoài phạm vi. [Bảo toàn](evidence/preservation-check.json), [kế hoạch trước](evidence/plan.before.md), [phép chèn](evidence/plan-update.json).

SHA-256 `next-env.d.ts` tại workspace chính giữ đúng **B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000**. Build chỉ tái tạo file đó bên trong TEMP; nguồn sản phẩm ở cả ba bản thực thi khớp manifest. Tập hash không bao gồm toàn bộ node_modules/.next hoặc mọi dữ liệu thật. [Đối chiếu bản sao](evidence/snapshot-source-check.json).

## 3. Tính độc lập và đóng tám lỗi PDF

[verify-independent.mjs](verify-independent.mjs) kế thừa nguyên **815/815 ca R29**; chỉ đổi vỏ đường dẫn, tiền tố, import và nhãn vòng, sau đó thêm bốn ca R30 về Name hợp lệ. Không xóa ID hoặc thay kỳ vọng cũ. So sánh 815 ID/tiêu chí/trạng thái đầu với bộ R29 nguyên bản vừa chạy khớp hoàn toàn. [append-r30.py](append-r30.py) dựng lại được đúng verifier; [nguồn gốc](evidence/harness-provenance.json), [kiểm hiện vật](evidence/artifact-check.json).

Bộ chính nạp thân hàm thật sau khi bỏ import/khai báo kiểu, dùng SQLite thật trong bộ nhớ và file giả; DOM/API/AI/giao diện được mô phỏng. Hai bộ [native media](native-media-repro.mjs) và [native worker](native-worker-repro.mjs) import trực tiếp TypeScript qua tsx, không cắt thân hàm hoặc sửa nguồn. Native là kiểm chứng chéo cùng mẫu, không cộng thêm vào 819. Các lần đầu R30 815/815 và native media 217/217 trước khi thêm bốn ca mới được giữ nguyên trong hồ sơ.

[pdf-oracle.py](pdf-oracle.py) dùng pypdf **6.10.2**, `strict=True`, quan sát **113 PDF** và ghi riêng hành vi phục hồi. [pdf_dict_oracle.py](pdf_dict_oracle.py) kiểm độc lập **54/54 kỳ vọng R29** trên byte từ điển chưa che; không dùng bộ đọc hoặc regex sản phẩm. pypdf có thể phục hồi file sai, nên việc mở được file không thay thế kiểm cú pháp. Không kiểm render hoặc chứng nhận đầy đủ PDF. Các ca WebP kế thừa vẫn được sharp/libwebp giải mã toàn bộ pixel. [Kết quả PDF](evidence/pdf-oracle-results.json).

Quy tắc đối chiếu là PDF 32000-1:2008, mục 7.2.2 Tables 1–2 và 7.3.7: sáu whitespace byte **00, 09, 0A, 0C, 0D, 20** và mười delimiter **()<>[]{}/%**. [Đặc tả Adobe](https://opensource.adobe.com/dc-acrobat-sdk-docs/standards/pdfstandards/pdf/PDF32000_2008.pdf), [nguồn tham chiếu](evidence/reference-sources.json).

Bản sửa quét liên tục từng byte, từ chối dấu phân cách rời thay vì bỏ qua; dùng đúng whitespace PDF tại bộ quét từ điển và kiểm giá trị con. Giữ kiểm INT/REAL, khóa thiếu/khóa trùng, Name, boolean/null, chuỗi/mảng/từ điển con, Length/reference/generation/stream và cây trang trong corpus kế thừa. Phần REAL cũng bỏ cú pháp số mũ vốn không thuộc dạng số PDF. Đã rà toàn bộ diff; không đổi worker.

| ID | Kết quả hiện tại | inlineData | Mẫu |
|---|---|---:|---|
| `R29-01-pdf-length-whitespace-nul` | PARSED | 1 | [PDF](evidence/fixtures/R29-01-pdf-length-whitespace-nul.pdf) |
| `R29-01-pdf-count-whitespace-nul` | PARSED | 1 | [PDF](evidence/fixtures/R29-01-pdf-count-whitespace-nul.pdf) |
| `R29-01-pdf-length-delimiter-lone-gt` | PARSE_ERROR | 0 | [PDF](evidence/fixtures/R29-01-pdf-length-delimiter-lone-gt.pdf) |
| `R29-01-pdf-count-delimiter-lone-gt` | PARSE_ERROR | 0 | [PDF](evidence/fixtures/R29-01-pdf-count-delimiter-lone-gt.pdf) |
| `R29-01-pdf-length-delimiter-brace-open` | PARSE_ERROR | 0 | [PDF](evidence/fixtures/R29-01-pdf-length-delimiter-brace-open.pdf) |
| `R29-01-pdf-count-delimiter-brace-open` | PARSE_ERROR | 0 | [PDF](evidence/fixtures/R29-01-pdf-count-delimiter-brace-open.pdf) |
| `R29-01-pdf-length-delimiter-brace-close` | PARSE_ERROR | 0 | [PDF](evidence/fixtures/R29-01-pdf-length-delimiter-brace-close.pdf) |
| `R29-01-pdf-count-delimiter-brace-close` | PARSE_ERROR | 0 | [PDF](evidence/fixtures/R29-01-pdf-count-delimiter-brace-close.pdf) |

Sáu dấu `>`, `{`, `}` rời hiện bị chặn và không có inlineData. Hai PDF NUL hợp lệ hiện được nhận với đúng một inlineData nguyên byte. Cả tám mẫu có SHA-256 trùng fixture R29. [Danh mục mẫu](evidence/fixture-manifest.json).

Hai nguồn TEMP R28/R29 đã khôi phục đều khớp **57/57 src/scripts** ghi trong manifest của từng vòng. [pdf-baseline-repro.mjs](pdf-baseline-repro.mjs) kiểm hash trước, chỉ đọc nguồn cũ rồi chạy trong VM tại bản TEMP R30; không sửa hai bản cũ. Kết quả **8/8**: tái hiện đủ tám lỗi trên nguồn R29 đúng hash và xác nhận nguồn hiện tại đã sửa. R28 nhận hai mẫu NUL; R29 từ chối; R30 nhận lại đúng. Đây là đối chứng hồi quy hai ca NUL có nguồn đã xác minh, khắc phục giới hạn baseline được ghi ở R29 mà không sửa hồ sơ R29. [Nguồn baseline](evidence/baseline-source-availability.json), [kết quả đối chứng](evidence/pdf-baseline-results.json).

## 4. R19-09 tiếp tục CLOSED_SOURCE

`grade-worker.ts` giữ nguyên SHA-256 R29; **277/277** ca gắn nhóm và **88/88** native worker đạt. [graphql-oracle.mjs](graphql-oracle.mjs) và [block-string-oracle.mjs](block-string-oracle.mjs) kiểm độc lập **88/88**, gồm 24 ca chuẩn hóa block string R29 và nhận xét đổi phải bị chặn. Không tái hiện VERIFIED sai trong các ca âm tính đã kiểm. [Native worker](evidence/native-worker-results.json), [oracle](evidence/graphql-oracle-results.json).

Giữ các rào chọn mutation/root/alias, biến được tham chiếu, loại STRING/ENUM, phản hồi đúng trường, HTTP 200/201, GraphQL errors, đọc lại và cập nhật VERIFIED theo hash. Đây là bằng chứng trong corpus giả; chưa xác nhận schema LMS thật.

## 4a. Lỗi mới R19-01 — P2: PDF hợp lệ có Name rỗng bị từ chối

**Nguyên nhân:** `validateRawPdfDict` tại [media-reader.ts](../../../src/lib/file-parsers/media-reader.ts):1222 dùng `return idx > ns ? "NAME" : null`, bắt buộc Name sau `/` có ít nhất một ký tự. PDF 32000-1 mục **7.3.5** xác định riêng dấu `/` là một Name hợp lệ có chuỗi tên rỗng. [Đặc tả Adobe](https://raw.githubusercontent.com/adobe/dc-acrobat-sdk-docs/master/docs/standards/pdfstandards/pdf/PDF32000_2008.pdf).

**Tái hiện:** [media-cases.mjs](media-cases.mjs) chỉ thêm `/Other << /Value / >>` hoặc `/Other [/]` vào từ điển Pages của cây trang/xref thật. Cả hai giữ `/Count 1` hợp lệ. Bộ chính và native trả **PARSE_ERROR, 0 inlineData**; kỳ vọng **PARSED, 1 inlineData nguyên byte**. Hai đối chứng chỉ đổi `/` thành `/Nonempty` đều đạt. ID lỗi: `R30-01-pdf-nested-empty-name` và `R30-01-pdf-array-empty-name`. [Hai mẫu PDF](evidence/new-findings.json).

[pdf-name-repro.mjs](pdf-name-repro.mjs) đọc nguồn R29 đúng hash trong VM: **4/4 mẫu được nhận**, chứng minh hai ca mới là hồi quy nguồn. [pdf-name-oracle.py](pdf-name-oracle.py) kiểm **4/4** bằng pypdf strict trên từ điển thật và PDF hoàn chỉnh (một trang), đồng thời bộ đọc byte độc lập nhận `('NAME', b'')`. Không dựa riêng vào cơ chế phục hồi của pypdf. [Đối chứng cũ/mới](evidence/pdf-name-results.json), [oracle](evidence/pdf-name-oracle-results.json).

**Ảnh hưởng:** PDF hợp lệ theo cú pháp bị gắn lỗi đọc file; giáo viên phải xử lý thủ công và bài không đi tiếp tới chấm. Chưa gọi AI thật, không suy ra điểm sai hoặc dữ liệu thật bị ảnh hưởng.

**Cách sửa hẹp:** phân biệt việc đã tiêu thụ dấu `/` tạo Name rỗng hợp lệ với việc không có giá trị sau khóa. Cho phép Name rỗng ở vị trí giá trị hợp lệ trong mảng/từ điển con, giữ kiểm tiêu thụ liên tục, dấu phân cách rời, khóa thiếu giá trị, INT/REAL, NUL và mọi rào đã đạt. Không sửa worker. [FIX_PROMPT.vi.md](FIX_PROMPT.vi.md).

## 5. Toàn bộ cổng chạy mới

Có **42 lệnh riêng biệt, 48 lượt thử**, giữ đủ stdout/stderr, mã thoát, thời gian và hash. **32 cổng cuối thoát 0**; ba cổng R30 (`round30`, `native30-media`, `pdf-name`) cùng tái hiện hai lỗi mới; bảy cổng lịch sử FAIL/BLOCKED được giữ nguyên và giải thích ở mục 7. Không gọi tất cả cổng lịch sử là PASS. Tên `tsx`, `tsc`, `next` dưới đây viết gọn; runner gọi đúng file trong node_modules bản sao. Lệnh và cwd tuyệt đối nằm trong [commands.json](evidence/commands.json); [tổng hợp](evidence/gate-summary.json).

| Bộ / lệnh | Kết quả cuối | Mã thoát | Bằng chứng |
|---|---|---:|---|
| round30 — `node docs/audits/round-30/verify-independent.mjs` | **817/819 FAIL** | 1 | [log](evidence/round30.attempt-2.log) |
| native30-media — `tsx docs/audits/round-30/native-media-repro.mjs` | **219/221 FAIL** | 1 | [log](evidence/native30-media.attempt-2.log) |
| native30-worker — `tsx docs/audits/round-30/native-worker-repro.mjs` | **88/88 PASS** | 0 | [log](evidence/native30-worker.attempt-1.log) |
| round29 — `node docs/audits/round-29/verify-independent.mjs` | **815/815 PASS** | 0 | [log](evidence/round29.attempt-1.log) |
| native29-media — `tsx docs/audits/round-29/native-media-repro.mjs` | **217/217 PASS** | 0 | [log](evidence/native29-media.attempt-1.log) |
| native29-worker — `tsx docs/audits/round-29/native-worker-repro.mjs` | **88/88 PASS** | 0 | [log](evidence/native29-worker.attempt-1.log) |
| round28 — `node docs/audits/round-28/verify-independent.mjs` | **737/737 PASS** | 0 | [log](evidence/round28.attempt-1.log) |
| native28-media — `tsx docs/audits/round-28/native-media-repro.mjs` | **163/163 PASS** | 0 | [log](evidence/native28-media.attempt-1.log) |
| native28-worker — `tsx docs/audits/round-28/native-worker-repro.mjs` | **64/64 PASS** | 0 | [log](evidence/native28-worker.attempt-1.log) |
| round27 — `node docs/audits/round-27/verify-independent.mjs` | **662/662 PASS** | 0 | [log](evidence/round27.attempt-1.log) |
| native27-media — `tsx docs/audits/round-27/native-media-repro.mjs` | **120/120 PASS** | 0 | [log](evidence/native27-media.attempt-1.log) |
| native27-worker — `tsx docs/audits/round-27/native-worker-repro.mjs` | **32/32 PASS** | 0 | [log](evidence/native27-worker.attempt-1.log) |
| round26 — `node docs/audits/round-26/verify-independent.mjs` | **510/510 PASS** | 0 | [log](evidence/round26.attempt-1.log) |
| native26-media — `tsx docs/audits/round-26/native-media-repro.mjs` | **94/94 PASS** | 0 | [log](evidence/native26-media.attempt-1.log) |
| native26-worker — `tsx docs/audits/round-26/native-worker-repro.mjs` | **54/54 PASS** | 0 | [log](evidence/native26-worker.attempt-1.log) |
| round25 — `node docs/audits/round-25/verify-independent.mjs` | **344/344 PASS** | 0 | [log](evidence/round25.attempt-1.log) |
| native25-media — `tsx docs/audits/round-25/native-media-repro.mjs` | **25/25 PASS** | 0 | [log](evidence/native25-media.attempt-1.log) |
| native25-worker — `tsx docs/audits/round-25/native-worker-repro.mjs` | **9/9 PASS** | 0 | [log](evidence/native25-worker.attempt-2.log) |
| round24 — `node docs/audits/round-24/verify-independent.mjs` | **230/230 PASS** | 0 | [log](evidence/round24.attempt-1.log) |
| round23 — `node docs/audits/round-23/verify-independent.mjs` | **116/116 PASS** | 0 | [log](evidence/round23.attempt-1.log) |
| round22 — `node docs/audits/round-22/verify-independent.mjs` | **53/53 PASS** | 0 | [log](evidence/round22.attempt-1.log) |
| native24 — `tsx docs/audits/round-24/native-media-repro.mjs` | **8/8 PASS** | 0 | [log](evidence/native24.attempt-1.log) |
| round12 — `node docs/audits/round-12/verify-independent.mjs` | **43/43 PASS** | 0 | [log](evidence/round12.attempt-1.log) |
| round13 — `node docs/audits/round-13/verify-independent.mjs` | **89/89 PASS** | 0 | [log](evidence/round13.attempt-1.log) |
| round15 — `node docs/audits/round-15/verify-independent.mjs` | **2 baseline đạt; 8 assertion lỗi/lệch lịch sử** | 1 | [log](evidence/round15.attempt-1.log) |
| round16 — `node docs/audits/round-16/verify-independent.mjs` | **15/16 FAIL lịch sử** | 1 | [log](evidence/round16.attempt-1.log) |
| round17 — `node docs/audits/round-17/verify-independent.mjs` | **38/38 PASS** | 0 | [log](evidence/round17.attempt-1.log) |
| round19 — `node docs/audits/round-19/verify-independent.mjs` | **89/94 FAIL lịch sử** | 1 | [log](evidence/round19.attempt-1.log) |
| round20 — `node docs/audits/round-20/verify-independent.mjs` | **140/145 FAIL lịch sử** | 1 | [log](evidence/round20.attempt-1.log) |
| round21 — `node docs/audits/round-21/verify-independent.mjs` | **45/49 FAIL lịch sử** | 1 | [log](evidence/round21.attempt-1.log) |
| historical14 — `node docs/audits/round-14/run-checks.mjs` | **BLOCKED_REPLAY_PRECONDITION** | 1 | [log](evidence/historical14.attempt-1.log) |
| historical18 — `node docs/audits/round-18/run-checks.mjs` | **BLOCKED_REPLAY_PRECONDITION** | 1 | [log](evidence/historical18.attempt-1.log) |
| phase4 — `tsx scripts/test-phase4-codex-repros.ts` | **PASS** | 0 | [log](evidence/phase4.attempt-2.log) |
| phase5 — `tsx scripts/test-phase5.ts` | **PASS** | 0 | [log](evidence/phase5.attempt-2.log) |
| typecheck-before — `tsc --noEmit --incremental false` | **PASS** | 0 | [log](evidence/typecheck-before.attempt-1.log) |
| build — `next build --webpack` | **PASS — 22/22 trang** | 0 | [log](evidence/build.attempt-1.log) |
| typecheck-after — `tsc --noEmit --incremental false` | **PASS** | 0 | [log](evidence/typecheck-after.attempt-1.log) |
| graphql-oracle — `node docs/audits/round-30/graphql-oracle.mjs` | **88/88 PASS** | 0 | [log](evidence/graphql-oracle.attempt-1.log) |
| pdf-oracle — `python docs/audits/round-30/pdf-oracle.py` | **54/54 kỳ vọng từ điển R29; quan sát 113 PDF** | 0 | [log](evidence/pdf-oracle.attempt-2.log) |
| pdf-baseline — `tsx docs/audits/round-30/pdf-baseline-repro.mjs` | **8/8; nguồn R28/R29 đúng hash** | 0 | [log](evidence/pdf-baseline.attempt-1.log) |
| pdf-name — `tsx docs/audits/round-30/pdf-name-repro.mjs` | **2/4 FAIL** | 1 | [log](evidence/pdf-name.attempt-1.log) |
| pdf-name-oracle — `python docs/audits/round-30/pdf-name-oracle.py` | **4/4 PASS** | 0 | [log](evidence/pdf-name-oracle.attempt-1.log) |

TypeScript trước/sau dùng đúng `--noEmit --incremental false`, chạy lần lượt trước và sau `next build --webpack` trong cùng bản sao chính. Build hoàn tất **22/22 trang**. Phase 4/5 đạt trong bản TEMP ngắn có cùng nguồn. [Phiên bản công cụ](evidence/runtime-versions.json).

## 6. Đối chiếu đủ 14 nhóm

`CLOSED_SOURCE` nghĩa là đạt trong nguồn/tình huống đã kiểm. Các ca gắn nhóm không gồm mọi ca API/COMPAT, nên không cộng bảng này thành 819. [Trạng thái và đủ ID](evidence/issue-status.json).

| Nhóm | Trạng thái | Đạt / tổng |
|---|---|---:|
| R19-01 — Đọc file hỏng | PARTIALLY_FIXED | 412/414 |
| R19-02 — Barem và tổng điểm | CLOSED_SOURCE | 2/2 |
| R19-03 — Hash bản duyệt | CLOSED_SOURCE | 2/2 |
| R19-04 — AI cũ hoặc file đổi | CLOSED_SOURCE | 5/5 |
| R19-05 — Duyệt phải kiểm toán | CLOSED_SOURCE | 5/5 |
| R19-06 — Duyệt bản đã xem | CLOSED_SOURCE | 68/68 |
| R19-07 — Đúng người và bài | CLOSED_SOURCE | 2/2 |
| R19-08 — Đúng lớp, buổi và lesson | CLOSED_SOURCE | 3/3 |
| R19-09 — Đúng API lưu điểm | CLOSED_SOURCE | 277/277 |
| R19-10 — Đọc lại đầy đủ | CLOSED_SOURCE | 5/5 |
| R19-11 — Cập nhật VERIFIED cuối | CLOSED_SOURCE | 3/3 |
| R19-12 — Giao diện và phản hồi cũ | CLOSED_SOURCE | 2/2 |
| R19-13 — Thứ tự lưu nháp bền | CLOSED_SOURCE | 22/22 |
| R19-14 — Phạm vi bài đưa vào AI | CLOSED_SOURCE | 2/2 |

## 7. Kết quả lịch sử nguyên bản

- **R12 43/43, R13 89/89, R17 38/38:** đạt khi chạy mới.
- **R16 15/16:** kỳ vọng bảy bảng đã cũ; hiện có tám bảng. Đối chứng schema R23 đạt.
- **R19 89/94:** bốn placeholder media không đủ cấu trúc bị từ chối; một approval thiếu bản giáo viên đã xem.
- **R20 140/145:** bốn approval thiếu bản đã xem; một phản hồi `saveGrade` không khớp mutation `saveHomeworkGrade`.
- **R21 45/49:** bốn control dùng phản hồi sai trường mutation; các đối chứng R26 đúng hợp đồng đạt.
- **R15:** `confirmedBugs=0`, `baselinePassed=2`, `executionErrors=8`, mã 1. Assertion tái hiện lỗi/hợp đồng cũ, fixture và schema bảy bảng không đạt. Không gọi là PASS hoặc khẳng định mọi lỗi cũ đã sửa từ kết quả này.
- **R14/R18:** chạy nguyên bản `run-checks.mjs` nhưng bị rào giữ hồ sơ chặn (`Do not overwrite a previous run`, `Audit already captured`). Không xóa file hoặc bỏ rào để chạy lại. Các bộ thành phần/TypeScript/build được chạy riêng.

Tập ID trượt R16/R19/R20/R21 khớp R29. Đủ **10/10 đối chứng tương thích** kế thừa đều chạy mới và đạt. Không đổi assertion, không dùng log cũ thay thực thi. [Giải thích và ID](evidence/historical-contract-differences.json).

## 8. Giới hạn và bàn giao

Rà nguồn cho thấy dev/start bind **127.0.0.1**; một persistent BrowserContext có khóa khởi tạo; save/download qua SequentialTaskQueue; đọc bài qua allowlist; HTTP 200/201, đóng toast, hash bản duyệt và cập nhật VERIFIED có điều kiện được giữ. Hai entrypoint giao diện Giai đoạn 5 không tham chiếu ba biến mật khẩu/khóa nhạy cảm trong quy tắc dự án. Đây là rà các đường liên quan, không phải chứng nhận an toàn toàn hệ thống.

Chưa đăng nhập hoặc thao tác LMS/Gemini thật; chưa dùng tài khoản/DB/bài nộp thật, chưa chạy trình duyệt/giao diện React thật, chưa xác nhận schema hay lưu/đọc lại LMS thật. Corpus PDF hẹp không bao phủ mọi tài liệu PDF. Kết luận NO-GO áp dụng đúng danh mục hash nguồn R30.

**Đã làm:** hoàn tất kiểm toán độc lập, giữ nguyên 815 ca R29, chạy đủ cổng yêu cầu, đối chứng tám lỗi bằng nguồn cũ đúng hash, xuất báo cáo/log/mẫu/hash và cập nhật kế hoạch.

**Kết quả:** **NO-GO cấp mã nguồn, 13/14 CLOSED_SOURCE**; đủ tám lỗi R29 đã đóng nhưng còn hai ca hồi quy mới thuộc R19-01 P2. Mục nghiệm thu sau R30 giữ [ ].

**Chưa kiểm tra:** tài khoản, dữ liệu, dịch vụ, trình duyệt và lưu/đọc lại LMS thật.

**Việc tiếp theo:** chuyển [FIX_PROMPT.vi.md](FIX_PROMPT.vi.md) cho bên triển khai sửa hẹp bộ đọc PDF, rồi kiểm toán lại nguồn cuối. Owner chưa cần chạy Terminal hoặc cung cấp tài khoản. Chưa ký nghiệm thu Giai đoạn 5.
