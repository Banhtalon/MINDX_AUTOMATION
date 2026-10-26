# AUDIT-R29 — Kiểm toán độc lập Giai đoạn 5

**Phán quyết: NO-GO cấp mã nguồn. 13/14 nhóm CLOSED_SOURCE; chưa nghiệm thu.**

Đã đóng đủ **9 ca lỗi R28**: bộ R28 chạy mới đạt **737/737**, native media **163/163**, native worker **64/64**. Nhóm **R19-09** đã CLOSED_SOURCE trong phạm vi kiểm chứng; không tái hiện VERIFIED sai trong các ca âm tính đã kiểm. [Đối chiếu 9 ca](evidence/r28-fix-closure.json).

R29 giữ nguyên 737 ca R28 và thêm **78 ca**, đạt **807/815**, còn **8 ca trượt mới thuộc R19-01, P2**: 6 PDF chứa dấu phân cách rời sai cú pháp vẫn được nhận; 2 PDF dùng NUL làm khoảng phân cách hợp lệ bị từ chối. Nạp trực tiếp mô-đun sản phẩm xác nhận đúng cả tám. Chưa đạt 14/14 nên mục nghiệm thu R29 giữ **[ ]**.

## 1. Nguồn đầu vào và cô lập

- Ngày kiểm toán: **21/10/2026**, giờ Việt Nam; chụp nguồn lúc `2026-10-20T20:38:38.186764+00:00` UTC.
- HEAD: `2570d96b6770957e218031c91f14ce98e766dfa7`. Workspace đã có nhiều thay đổi chưa commit trước kiểm toán; không reset, commit hoặc sửa sản phẩm. [Trạng thái đầu](evidence/source-state.json).
- Danh mục **74 file**, gồm **57 src/scripts**; SHA-256 tổng hợp: `b2eb2d0eee51744fb6cad2af95e86d976a9b1133b8e8afb2d679a1e3525269fa`. [Danh mục nguồn](evidence/source-manifest.json).
- So với danh mục hash R28, chỉ hai file sản phẩm đã đổi từ trước vòng này: `media-reader.ts` và `grade-worker.ts`; kế hoạch cũng khác do mục tài liệu cuối R28. [Đối chiếu](evidence/changes-since-r28.json).
- SHA-256 `src/lib/file-parsers/media-reader.ts`: `c019389c427ca6c0ce0607309850100f1d46020a0c942727e585aa6fbddb9a1a`.
- SHA-256 `src/lib/playwright/grade-worker.ts`: `f5db4a78fcdd2b2022a6c663444e0f6c24acfc6600da884cd5b62a75fef33d73`.
- Đã đọc AGENTS.md, TASK-5.1–5.5 và điều kiện nghiệm thu, REPORT/FIX_PROMPT R28; rà hai bản sửa cùng luồng tải đúng ID → đọc file → AI theo barem → cộng/kiểm toán điểm → duyệt đúng bản đã xem → lưu LMS → đọc lại → VERIFIED theo hash.

Bản sao chính đúng tiền tố tương thích yêu cầu:

```text
C:\Users\QQ\AppData\Local\Temp\mindx-round29-20261020T203838Z-mindx-round28-compat-mindx-round27-compat-mindx-round26-compat-mindx-round25-compat-mindx-round24-compat-mindx-round23-compat-mindx-round22-compat\snapshot
```

Bản sao phụ chạy R20/R21:

```text
C:\Users\QQ\AppData\Local\Temp\mindx-round29-history-20261020T203838Z-mindx-round20-compat-mindx-round21-compat\snapshot
```

Tất cả lần thực thi sản phẩm, SQLite giả, TypeScript và build đều trong TEMP. Thư viện được sao chép vật lý, không dùng junction nối workspace chính. Không mang `.env`, `.env.local`, `.git`, hồ sơ `playwright-auth`, DB hoặc bài nộp thật vào bản sao. Môi trường tiến trình được lọc; rào Node chặn TCP/DNS/fetch, vẫn cho named pipe của công cụ nội bộ. Không khởi động server/trình duyệt thật, không gọi LMS/Gemini. [Cô lập](evidence/isolation.json), [bản sao phụ](evidence/secondary-snapshot.json).

## 2. Bộ kiểm chứng và tính độc lập

[verify-independent.mjs](verify-independent.mjs) giữ nguyên **737 ID, điều kiện và kỳ vọng R28**, chỉ đổi vỏ đường dẫn/tiền tố/nhãn vòng và thêm ca R29. [assemble-verifier.py](assemble-verifier.py) dựng lại được đúng byte đã chạy; [nguồn gốc](evidence/harness-provenance.json) và [kiểm hiện vật](evidence/artifact-check.json) ghi hash. 737 kết quả đầu trùng ID, tiêu chí và trạng thái với bộ R28 nguyên bản vừa chạy.

| Phần | Đạt / tổng | Trượt |
|---|---:|---:|
| R28 kế thừa nguyên vẹn | **737/737** | 0 |
| PDF mới R29 | **46/54** | 8 |
| GraphQL mới R29 | **24/24** | 0 |
| **Tổng R29** | **807/815** | **8** |

Bộ chính dùng cơ chế kế thừa nạp thân hàm sản phẩm sau khi bỏ khai báo kiểu/import; SQLite thật trong bộ nhớ, file giả vật lý, DOM/API/AI và hook giao diện mô phỏng. Hai bộ [native-media-repro.mjs](native-media-repro.mjs) và [native-worker-repro.mjs](native-worker-repro.mjs) import trực tiếp TypeScript qua tsx, không cắt thân hàm hoặc sửa nguồn. Native media **209/217**, native worker **88/88**; tập tám ID trượt khớp chính xác bộ chính. Native là kiểm chứng chéo cùng mẫu, không cộng vào 815.

[graphql-oracle.mjs](graphql-oracle.mjs) kiểm độc lập **88/88** ca: 64 ca kế thừa bằng scanner/parser riêng, 24 ca mới bằng [thuật toán tuần tự độc lập và giá trị chữ kỳ vọng](block-string-oracle.mjs). Ca mới bao phủ dòng đầu, thụt đầu dòng, dòng trắng ở hai đầu/ở giữa, LF/CRLF/CR, tab, dấu nháy, escape ba dấu nháy, backslash và dấu ngoặc/comment trong chuỗi. Mỗi giá trị hợp lệ đi kèm đối chứng nhận xét bị thay đổi phải bị chặn. Không xác nhận schema LMS thật.

[pdf-oracle.py](pdf-oracle.py) quan sát **113 PDF** bằng pypdf 6.10.2, `strict=True`, ghi riêng hành vi phục hồi. [pdf_dict_oracle.py](pdf_dict_oracle.py) đọc từ điển thật từng byte, dùng đúng tập whitespace/delimiter PDF và xác nhận **54/54 kỳ vọng R29**; không dùng regex hoặc từ điển đã che của sản phẩm. Đây là kiểm cú pháp/hợp đồng cho corpus hẹp, không phải chứng nhận mọi tính năng PDF hay kiểm render. Các WebP kế thừa tiếp tục giải mã đầy đủ pixel bằng sharp/libwebp. [PDF](evidence/pdf-oracle-results.json), [GraphQL](evidence/graphql-oracle-results.json).

Hai kỳ vọng mẫu đầu về `/Other /Dangling` đã được sửa thành đối chứng hợp lệ vì `/Dangling` là giá trị Name. Giữ nguyên kết quả lần đầu, không tính nhầm thành lỗi sản phẩm. Các vấn đề đường dẫn Windows và lần thăm dò baseline đều được giữ và giải thích tại [ghi chú bộ kiểm](evidence/harness-development-notes.md).

## 3. Toàn bộ cổng chạy mới

Có **37 lệnh riêng biệt, 52 lượt thử**, giữ đủ stdout/stderr, mã thoát và hash. Lệnh trong bảng chạy từ snapshot tương ứng; dạng `tsx` là cách viết gọn cho `node node_modules/tsx/dist/cli.mjs`, `tsc` và `next` cũng gọi đúng file trong node_modules bản sao. Đường dẫn tuyệt đối và thời gian ở [commands.json](evidence/commands.json). Mã 0 của phép kiểm hash baseline chỉ nói phép kiểm đã chạy xong; trạng thái vẫn là không có baseline đúng nguồn.

| Bộ / lệnh | Kết quả cuối | Mã thoát | Bằng chứng |
|---|---|---:|---|
| round29 — `node docs/audits/round-29/verify-independent.mjs` | **807/815 FAIL** | 1 | [log](evidence/round29.attempt-2.log) |
| native29-media — `tsx docs/audits/round-29/native-media-repro.mjs` | **209/217 FAIL** | 1 | [log](evidence/native29-media.attempt-2.log) |
| native29-worker — `tsx docs/audits/round-29/native-worker-repro.mjs` | **88/88 PASS** | 0 | [log](evidence/native29-worker.attempt-2.log) |
| round28 — `node docs/audits/round-28/verify-independent.mjs` | **737/737 PASS** | 0 | [log](evidence/round28.attempt-1.log) |
| native28-media — `tsx docs/audits/round-28/native-media-repro.mjs` | **163/163 PASS** | 0 | [log](evidence/native28-media.attempt-2.log) |
| native28-worker — `tsx docs/audits/round-28/native-worker-repro.mjs` | **64/64 PASS** | 0 | [log](evidence/native28-worker.attempt-2.log) |
| round27 — `node docs/audits/round-27/verify-independent.mjs` | **662/662 PASS** | 0 | [log](evidence/round27.attempt-1.log) |
| native27-media — `tsx docs/audits/round-27/native-media-repro.mjs` | **120/120 PASS** | 0 | [log](evidence/native27-media.attempt-2.log) |
| native27-worker — `tsx docs/audits/round-27/native-worker-repro.mjs` | **32/32 PASS** | 0 | [log](evidence/native27-worker.attempt-2.log) |
| round26 — `node docs/audits/round-26/verify-independent.mjs` | **510/510 PASS** | 0 | [log](evidence/round26.attempt-1.log) |
| native26-media — `tsx docs/audits/round-26/native-media-repro.mjs` | **94/94 PASS** | 0 | [log](evidence/native26-media.attempt-2.log) |
| native26-worker — `tsx docs/audits/round-26/native-worker-repro.mjs` | **54/54 PASS** | 0 | [log](evidence/native26-worker.attempt-2.log) |
| round25 — `node docs/audits/round-25/verify-independent.mjs` | **344/344 PASS** | 0 | [log](evidence/round25.attempt-1.log) |
| native25-media — `tsx docs/audits/round-25/native-media-repro.mjs` | **25/25 PASS** | 0 | [log](evidence/native25-media.attempt-2.log) |
| native25-worker — `tsx docs/audits/round-25/native-worker-repro.mjs` | **9/9 PASS** | 0 | [log](evidence/native25-worker.attempt-2.log) |
| round24 — `node docs/audits/round-24/verify-independent.mjs` | **230/230 PASS** | 0 | [log](evidence/round24.attempt-1.log) |
| round23 — `node docs/audits/round-23/verify-independent.mjs` | **116/116 PASS** | 0 | [log](evidence/round23.attempt-1.log) |
| round22 — `node docs/audits/round-22/verify-independent.mjs` | **53/53 PASS** | 0 | [log](evidence/round22.attempt-1.log) |
| native24 — `tsx docs/audits/round-24/native-media-repro.mjs` | **8/8 PASS** | 0 | [log](evidence/native24.attempt-2.log) |
| round12 — `node docs/audits/round-12/verify-independent.mjs` | **43/43 PASS** | 0 | [log](evidence/round12.attempt-1.log) |
| round13 — `node docs/audits/round-13/verify-independent.mjs` | **89/89 PASS** | 0 | [log](evidence/round13.attempt-1.log) |
| round15 — `node docs/audits/round-15/verify-independent.mjs` | **2 baseline đạt; 8 assertion lỗi/lệch lịch sử** | 1 | [log](evidence/round15.attempt-1.log) |
| round16 — `node docs/audits/round-16/verify-independent.mjs` | **15/16 FAIL** | 1 | [log](evidence/round16.attempt-1.log) |
| round17 — `node docs/audits/round-17/verify-independent.mjs` | **38/38 PASS** | 0 | [log](evidence/round17.attempt-1.log) |
| round19 — `node docs/audits/round-19/verify-independent.mjs` | **89/94 FAIL** | 1 | [log](evidence/round19.attempt-1.log) |
| round20 — `node docs/audits/round-20/verify-independent.mjs` | **140/145 FAIL** | 1 | [log](evidence/round20.attempt-2.log) |
| round21 — `node docs/audits/round-21/verify-independent.mjs` | **45/49 FAIL** | 1 | [log](evidence/round21.attempt-1.log) |
| historical14 — `node docs/audits/round-14/run-checks.mjs` | **BLOCKED_REPLAY_PRECONDITION** | 1 | [log](evidence/historical14.attempt-1.log) |
| historical18 — `node docs/audits/round-18/run-checks.mjs` | **BLOCKED_REPLAY_PRECONDITION** | 1 | [log](evidence/historical18.attempt-1.log) |
| phase4 — `tsx scripts/test-phase4-codex-repros.ts` | **PASS** | 0 | [log](evidence/phase4.attempt-1.log) |
| phase5 — `tsx scripts/test-phase5.ts` | **PASS** | 0 | [log](evidence/phase5.attempt-1.log) |
| typecheck-before — `tsc --noEmit --incremental false` | **PASS** | 0 | [log](evidence/typecheck-before.attempt-1.log) |
| build — `next build --webpack` | **PASS — 22/22 trang** | 0 | [log](evidence/build.attempt-1.log) |
| typecheck-after — `tsc --noEmit --incremental false` | **PASS** | 0 | [log](evidence/typecheck-after.attempt-1.log) |
| graphql-oracle — `node docs/audits/round-29/graphql-oracle.mjs` | **88/88 PASS** | 0 | [log](evidence/graphql-oracle.attempt-1.log) |
| pdf-oracle — `python docs/audits/round-29/pdf-oracle.py` | **54/54 kỳ vọng R29; quan sát 113 PDF** | 0 | [log](evidence/pdf-oracle.attempt-2.log) |
| pdf-baseline — `tsx docs/audits/round-29/pdf-baseline-repro.mjs` | **BASELINE_SOURCE_HASH_MISMATCH; không chạy sản phẩm cũ** | 0 | [log](evidence/pdf-baseline.attempt-2.log) |

TypeScript trước/sau dùng đúng `--noEmit --incremental false`. Build webpack hoàn tất **22/22 trang**, chỉ đổi `next-env.d.ts` trong snapshot. Các mẫu nguồn sản phẩm không đổi trong lúc kiểm. Node v24.21.0, Next 16.4.2, TypeScript 7.0.2, tsx 4.23.15; [phiên bản](evidence/runtime-versions.json).

## 4. Đối chiếu đủ 14 nhóm

`CLOSED_SOURCE` là đạt trong phạm vi nguồn và tình huống đã kiểm, không thay cho nghiệm thu LMS thật. Ca gắn nhóm không bao gồm mọi ca API/COMPAT nên không cộng bảng này thành tổng 815. [Trạng thái và đủ ID](evidence/issue-status.json).

| Nhóm | Trạng thái | Ca gắn nhóm đạt / tổng |
|---|---|---:|
| R19-01 — Đọc file hỏng | PARTIALLY_FIXED, P2 | 402/410 |
| R19-02 — Barem và tổng điểm | CLOSED_SOURCE | 2/2 |
| R19-03 — Hash bản duyệt | CLOSED_SOURCE | 2/2 |
| R19-04 — AI cũ hoặc file đổi | CLOSED_SOURCE | 5/5 |
| R19-05 — Duyệt phải kiểm toán | CLOSED_SOURCE | 5/5 |
| R19-06 — Duyệt bản xem cũ | CLOSED_SOURCE | 68/68 |
| R19-07 — Đúng người và bài | CLOSED_SOURCE | 2/2 |
| R19-08 — Đúng lớp, buổi và lesson | CLOSED_SOURCE | 3/3 |
| R19-09 — Đúng API lưu điểm | CLOSED_SOURCE | 277/277 |
| R19-10 — Đọc lại đầy đủ | CLOSED_SOURCE | 5/5 |
| R19-11 — Cập nhật VERIFIED cuối | CLOSED_SOURCE | 3/3 |
| R19-12 — Giao diện và phản hồi cũ | CLOSED_SOURCE | 2/2 |
| R19-13 — Thứ tự lưu nháp bền | CLOSED_SOURCE | 22/22 |
| R19-14 — Phạm vi bài đưa vào AI | CLOSED_SOURCE | 2/2 |

Mười đối chứng tương thích kế thừa đều chạy mới và đạt: schema tám bảng R23, bốn ca snapshot duyệt R24, năm ca đúng trường phản hồi R26. Không sửa kết quả bộ lịch sử để làm xanh. [Đối chiếu hợp đồng](evidence/historical-contract-differences.json).

## 5. R19-01 — P2: sáu từ điển PDF sai cú pháp vẫn được nhận

**Nguyên nhân:** `parsePdfDictEntries` dùng `scalarDict.match(...)` ở [media-reader.ts](../../../src/lib/file-parsers/media-reader.ts):1226–1229. Regex chỉ nhặt các đoạn khớp, bỏ qua ký tự không khớp; các dấu `>`, `{`, `}` rời bị mất thay vì gây lỗi. Vì vậy `/Length 8>` hoặc `/Count 1{` biến thành đúng token số rồi được nhận. Bản sửa đã kiểm kiểu số đầy đủ, nhưng chưa chứng minh mọi byte trong từ điển được tiêu thụ hợp lệ.

**Tái hiện:** sáu mẫu delimiter trong bảng mục 7 có đồ thị Catalog/Pages/Page và xref thật, chỉ thêm đúng một dấu phân cách rời vào giá trị Length/Count. Bộ chính và native đều trả **PARSED, 1 inlineData**, giữ nguyên byte file sai. Bộ đọc cú pháp độc lập từ chối đúng vị trí dấu rời. pypdf đôi lúc phục hồi nên việc nó mở được mẫu không phủ định lỗi cú pháp.

**Ảnh hưởng:** PDF không đạt rào cấu trúc vẫn được phép đi tiếp tới luồng chấm. Chưa gọi AI thật và không kết luận đã có điểm sai hoặc REDO thật.

**Cách sửa hẹp:** đọc token từ vị trí hiện tại, tiêu thụ liên tục; mỗi byte ngoài whitespace/comment phải thuộc một token/cấu trúc hợp lệ. Gặp ký tự rời phải lỗi. Giữ giá trị Name, số, boolean, null, chuỗi, mảng và từ điển con hợp lệ; không cấm những ký tự này bên trong chuỗi dữ liệu.

PDF 32000-1 phân loại dấu phân cách tại 7.2.2 và cấu trúc cặp khóa/giá trị tại 7.3.7. [Đặc tả Adobe](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/PDF32000_2008.pdf), [dấu kiểm tài liệu tham chiếu](evidence/reference-sources.json).

## 6. R19-01 — P2: hai PDF có NUL hợp lệ bị từ chối

**Nguyên nhân:** cùng regex trên dùng `\s` của JavaScript để ngăn token. Tập này thiếu byte **00 (NUL)** vốn là whitespace PDF, nên `/Length 8<NUL>` và `/Count 1<NUL>` bị đọc như số có đuôi lạ.

**Tái hiện:** hai mẫu NUL kỳ vọng PARSED và một inlineData nguyên byte; bộ chính và native trả **PARSE_ERROR, 0 inlineData**. Bộ đọc độc lập nhận số INT 8/1 và từ điển hợp lệ; pypdf đọc Count/Length là NumberObject. Các đối chứng tab/LF/FF/CR cùng khóa bổ sung hợp lệ đều đạt.

**Ảnh hưởng:** tài liệu đạt điều kiện kiểm tra hiện tại có thể bị báo lỗi đọc file, khiến giáo viên phải xử lý thủ công.

**Cách sửa hẹp:** dùng đúng sáu byte whitespace PDF: 00, 09, 0A, 0C, 0D, 20. Không xóa NUL toàn file vì nó có thể là dữ liệu stream/chuỗi và việc xóa làm lệch độ dài byte. Quy tắc nằm ở Table 1, 7.2.2 của [đặc tả Adobe](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/PDF32000_2008.pdf).

Không gọi hai ca này là hồi quy đã được chạy chứng minh: bản TEMP R28 cũ hiện không còn khớp hash nguồn ghi trong R28. Rào kiểm hash đã chặn việc dùng nó làm baseline; không chạy nguồn đó, không sửa bản cũ. Kết quả hiện tại vẫn được xác nhận bằng chính nguồn mới, fixture và đặc tả. [Giới hạn baseline](evidence/baseline-source-availability.json), [kết quả kiểm hash](evidence/pdf-baseline-results.json).

## 7. Tám mẫu lỗi có thể chuyển giao

| ID | Kỳ vọng → thực tế | Mẫu |
|---|---|---|
| `R29-01-pdf-length-whitespace-nul` | PARSED → PARSE_ERROR, 0 inlineData | [PDF](evidence/fixtures/R29-01-pdf-length-whitespace-nul.pdf) |
| `R29-01-pdf-count-whitespace-nul` | PARSED → PARSE_ERROR, 0 inlineData | [PDF](evidence/fixtures/R29-01-pdf-count-whitespace-nul.pdf) |
| `R29-01-pdf-length-delimiter-lone-gt` | PARSE_ERROR → PARSED, 1 inlineData | [PDF](evidence/fixtures/R29-01-pdf-length-delimiter-lone-gt.pdf) |
| `R29-01-pdf-count-delimiter-lone-gt` | PARSE_ERROR → PARSED, 1 inlineData | [PDF](evidence/fixtures/R29-01-pdf-count-delimiter-lone-gt.pdf) |
| `R29-01-pdf-length-delimiter-brace-open` | PARSE_ERROR → PARSED, 1 inlineData | [PDF](evidence/fixtures/R29-01-pdf-length-delimiter-brace-open.pdf) |
| `R29-01-pdf-count-delimiter-brace-open` | PARSE_ERROR → PARSED, 1 inlineData | [PDF](evidence/fixtures/R29-01-pdf-count-delimiter-brace-open.pdf) |
| `R29-01-pdf-length-delimiter-brace-close` | PARSE_ERROR → PARSED, 1 inlineData | [PDF](evidence/fixtures/R29-01-pdf-length-delimiter-brace-close.pdf) |
| `R29-01-pdf-count-delimiter-brace-close` | PARSE_ERROR → PARSED, 1 inlineData | [PDF](evidence/fixtures/R29-01-pdf-count-delimiter-brace-close.pdf) |

[fixture-manifest.json](evidence/fixture-manifest.json) ghi SHA-256 và kích thước từng mẫu. [Bộ chính](evidence/verify-results.json), [native media](evidence/native-media-results.json), [native worker](evidence/native-worker-results.json) lưu byte mẫu/yêu cầu/phản hồi và quan sát. Tất cả là dữ liệu giả.

## 8. R19-09 đã đóng trong phạm vi nguồn

Ba ca LF, CRLF và tab của R28 đều đạt; cả **277/277** ca gắn nhóm và **88/88** native worker đạt. Bản sửa áp dụng chuẩn hóa dòng, tính thụt đầu dòng chung từ các dòng sau dòng đầu, bỏ dòng trắng hai đầu rồi nối LF tại lúc tạo token STRING. Đối chiếu [BlockStringValue trong đặc tả GraphQL September 2025](https://spec.graphql.org/September2025/#sec-String-Value) và oracle độc lập xác nhận corpus.

Các ca R27/R28 chống chuỗi giả operation/root, ENUM giả STRING, biến không được tham chiếu, phản hồi sai trường, sai ID/nội dung, HTTP lỗi và đọc lại không khớp tiếp tục đạt trong bộ kế thừa. Không phát hiện đường VERIFIED sai trong các ca đã chạy. Điều này không bảo đảm mọi truy vấn GraphQL đều hỗ trợ hoặc khớp schema LMS thật.

## 9. Kết quả lịch sử nguyên bản

- **R12 43/43, R13 89/89, R17 38/38:** đạt khi chạy mới.
- **R16 15/16:** một kỳ vọng bảy bảng trong khi sản phẩm hiện có tám bảng; đối chứng schema R23 đạt.
- **R19 89/94:** bốn placeholder media không đủ cấu trúc bị bộ đọc chặt hơn từ chối; một approval thiếu snapshot giáo viên đã xem.
- **R20 140/145:** bốn approval thiếu snapshot và một phản hồi `saveGrade` không khớp mutation `saveHomeworkGrade`.
- **R21 45/49:** bốn control dùng phản hồi sai trường mutation; đối chứng R26 đúng hợp đồng đạt.
- **R15:** `confirmedBugs=0`, `baselinePassed=2`, `executionErrors=8`, mã thoát 1. Assertion tái hiện lỗi/hợp đồng cũ và schema bảy bảng không đạt, gồm lỗi kiểu dữ liệu fixture. Không gọi là PASS hoặc dùng để khẳng định mọi lỗi cũ đã sửa.
- **R14/R18:** không có verify-independent riêng; thử nguyên bản run-checks và bị rào một lần ghi hồ sơ chặn (`Do not overwrite a previous run`, `Audit already captured`). Không xóa dữ liệu cũ hoặc bỏ rào. Các bộ thành phần và TypeScript/build đã được chạy riêng.

Tập ID trượt R16/R19/R20/R21 giống nguyên tập R28. Đây là so sánh từ lần chạy mới, không lấy log cũ thay việc thực thi. Kết quả FAIL/BLOCKED lịch sử được giữ và giải thích riêng, không chuyển thành PASS sản phẩm.

## 10. Bảo toàn và giới hạn

**905/905 file bảo vệ** (`next-env.d.ts` và toàn bộ R12–R28), **57/57 src/scripts** giữ nguyên từng byte. Trong tập SHA-256 **982 file** ngoài R29, chỉ kế hoạch thay đổi bằng phép chèn mục AUDIT-R29 được ghi nhận. Tập kiểm không bao gồm toàn bộ node_modules/.next hay mọi dữ liệu thật. [Bảo toàn](evidence/preservation-check.json), [kế hoạch trước](evidence/plan.before.md), [phép chèn](evidence/plan-update.json).

SHA-256 `next-env.d.ts` ở workspace chính giữ đúng **B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000**. Không đổi checkbox TASK-5.x hoặc mục nghiệm thu cũ; chỉ đánh dấu hoàn tất kiểm toán R29, mục nghiệm thu R29 để [ ]. Không thay INDEX/LATEST ngoài phạm vi yêu cầu.

Rà nguồn hiện tại cho thấy dev/start vẫn bind 127.0.0.1; một persistent BrowserContext có khóa khởi tạo; save/download qua SequentialTaskQueue; đọc bài qua allowlist; HTTP 200/201, đóng toast, hash bản duyệt và cập nhật VERIFIED có điều kiện được giữ. Hai entrypoint giao diện Giai đoạn 5 không tham chiếu ba biến mật khẩu/khóa nhạy cảm đã nêu trong quy tắc. Đây là rà phạm vi Giai đoạn 5 cùng bộ kiểm kế thừa, không phải kiểm thâm nhập toàn hệ thống. [Rà nguồn](evidence/static-review.json).

Chưa đăng nhập LMS/Gemini, chưa dùng tài khoản/DB/bài nộp thật; chưa chạy trình duyệt, giao diện React hoặc lưu/đọc lại LMS thật. Không xác nhận schema LMS hay nghiệm thu vận hành thật. Baseline TEMP cũ không đủ điều kiện hash, R14/R18 không thể chạy lại trọn bộ vì rào giữ lịch sử của chính runner.

## 11. Đã làm / Kết quả / Chưa kiểm tra / Việc tiếp theo

**Đã làm:** kiểm toán độc lập đúng nguồn, chạy toàn bộ cổng yêu cầu, giữ 737 ca R28 và thêm 78 ca; xác nhận chéo tám lỗi PDF, xuất mẫu/log/hash và cập nhật kế hoạch.

**Kết quả:** **NO-GO, 13/14 CLOSED_SOURCE**, còn R19-01 P2. Toàn bộ chín lỗi R28 đã đóng; build và TypeScript đạt không thay thế tám FAIL mới.

**Chưa kiểm tra:** tài khoản/dữ liệu/dịch vụ và lưu LMS thật; giao diện/trình duyệt thật; không xác nhận baseline R28 đã bị đổi trong TEMP.

**Việc tiếp theo:** chuyển [FIX_PROMPT.vi.md](FIX_PROMPT.vi.md) cho bên triển khai sửa bộ đọc PDF rồi kiểm toán lại nguồn cuối. Owner chưa cần chạy Terminal hoặc cung cấp tài khoản. Chưa ký nghiệm thu Giai đoạn 5.
