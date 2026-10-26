# AUDIT-R31 — Kiểm toán độc lập Giai đoạn 5

**Quyết định: GO cấp mã nguồn — 14/14 nhóm R19-01..R19-14 đạt CLOSED_SOURCE.**

Hai lỗi PDF Name rỗng của R30 đã đóng; không phát hiện lỗi sản phẩm mới trong phần nguồn đã rà, 819 ca kế thừa và 28 ca biên bổ sung. Quyết định gắn với đúng danh mục nguồn bên dưới; chưa phải nghiệm thu vận hành LMS/Gemini thật.

## 1. Kết quả chính

| Kiểm tra | Kết quả chạy mới |
|---|---:|
| R31 và R30 nguyên bản | 819/819 mỗi bộ |
| Native media R31 và R30 | 221/221 mỗi bộ |
| Native worker R31 và R30 | 88/88 mỗi bộ |
| pdf-name-repro | 4/4 |
| Name: pypdf strict và bộ đọc byte độc lập | 4/4 |
| pdf_dict_oracle | 54/54 |
| graphql_worker_oracle.py | 88/88 |
| Oracle GraphQL JS kế thừa | 88/88 |
| Biên bổ sung về Name/khóa/thiếu giá trị | 28/28 |
| Phase 4 và Phase 5 | PASS |
| TypeScript trước và sau build | PASS, `--noEmit --incremental false` |
| `next build --webpack` | PASS, 22/22 trang |

Toàn bộ R29..R22 cùng các bộ native yêu cầu chạy mới đạt. Chuỗi R12..R21 đã chạy đầy đủ các entrypoint như các vòng trước: R12/R13/R17 đạt; R15/R16/R19/R20/R21 giữ FAIL lịch sử, R14/R18 giữ BLOCKED. Sai khác ID và kỳ vọng không đổi so với R30; 10 đối chứng tương thích hiện tại đạt. Không sửa bộ kiểm cũ để biến kết quả thành xanh. Xem [ma trận đủ 48 cổng](REGRESSION_MATRIX.md), [tổng hợp](evidence/gate-summary.json), [71 lượt và lệnh đầy đủ](evidence/commands.json).

Có **41 cổng PASS, 5 FAIL lịch sử, 2 BLOCKED lịch sử** ở lượt cuối. Native và oracle kiểm chứng chéo cùng mẫu, không được cộng trùng vào 819 ca chính.

## 2. Nguồn được kiểm

- Ngày kiểm toán: **21/10/2026**, giờ Việt Nam; chụp nguồn lúc `2026-10-20T23:35:26.032953+00:00` UTC.
- HEAD: `2570d96b6770957e218031c91f14ce98e766dfa7`. Nguồn có thay đổi chưa commit từ trước; không reset, phục hồi đè hoặc sửa sản phẩm. [Trạng thái đầu](evidence/source-state.json).
- Danh mục **74 file**, gồm **57 src/scripts**. SHA-256 tổng hợp: `ba270b6e64b53e1bf5df991cb7b9dec7c0ab36b66c3f878f07464aa08865126e`. [Manifest](evidence/source-manifest.json).
- `media-reader.ts`: `2c42b5d4d3a6a3f0f09c9b86bc44f01fcbcb70fb22ee50a15c941b1bf640e3f0`.
- `grade-worker.ts`: `f5db4a78fcdd2b2022a6c663444e0f6c24acfc6600da884cd5b62a75fef33d73` — giữ nguyên so với R30.

So với manifest R30, chỉ **`src/lib/file-parsers/media-reader.ts`** đổi trong src/scripts. Kế hoạch có khác biệt do hồ sơ R30 đã được cập nhật sau lần chụp R30; đó là trạng thái có sẵn trước R31. R31 không cập nhật kế hoạch. [Đối chiếu](evidence/changes-since-r30.json), [toàn bộ diff](evidence/media-reader.since-r30.diff).

Đã đọc AGENTS.md, yêu cầu TASK-5.1..5.5, báo cáo/prompt sửa R30 và luồng liên quan: tải bài gắn định danh, allowlist đường dẫn, parser, ẩn danh/kiểm điểm AI, duyệt/hash, thứ tự lưu nháp, worker/API lưu và đọc lại, giao diện gọi các bước này. Tải dự kiến là một giáo viên dùng cục bộ; thao tác trình duyệt nối tiếp, nhưng phản hồi AI/nháp/giao diện có thể về sai thứ tự. Đây là kiểm toán Giai đoạn 5 cùng các cổng hồi quy, không phải kiểm thâm nhập toàn dự án. [Rà nguồn](evidence/static-review.json), [ghi chú delta](evidence/source-review-notes.json).

## 3. Đóng hoàn toàn R19-01 trong phạm vi mã nguồn

**Nguyên nhân trước sửa:** bộ đọc coi tên sau dấu `/` bắt buộc có ký tự, nên từ chối Name rỗng hợp lệ. Lần này `validateRawPdfDict` đã tiêu thụ `/` và trả loại NAME; `parsePdfDictEntries` giữ token `/` và chấp nhận nó tại vị trí Name. Tên khóa cũng có thể rỗng; kiểm khóa trùng, thiếu giá trị và dấu phân cách rời vẫn còn.

PDF 32000-1 mục **7.3.5**, trang PDF **25** (trang in **17**), cho phép Name rỗng sau SOLIDUS. Đã tải mới bản đặc tả từ [kho Adobe](https://raw.githubusercontent.com/adobe/dc-acrobat-sdk-docs/master/docs/standards/pdfstandards/pdf/PDF32000_2008.pdf), kiểm đoạn quy tắc và SHA-256; công cụ web không mở được file 22 MB nên kiểm nội dung trong bộ nhớ. [Nguồn tham chiếu](evidence/reference-sources.json).

| ID giữ nguyên từ R30 | Nguồn R30 đúng hash | Nguồn hiện tại | inlineData |
|---|---|---|---:|
| R30-01-pdf-nested-empty-name | PARSE_ERROR | PARSED | 1 |
| R30-01-pdf-array-empty-name | PARSE_ERROR | PARSED | 1 |
| R30-01-pdf-nested-name-control (`/Nonempty`) | PARSED | PARSED | 1 |
| R30-01-pdf-array-name-control (`/Nonempty`) | PARSED | PARSED | 1 |

[pdf-name-repro.mjs](pdf-name-repro.mjs) import trực tiếp sản phẩm hiện tại, đồng thời nạp nguồn R30 trong VM sau khi kiểm hash. Bản nguồn cũ được lưu trong hồ sơ R31 để chạy lại mà không phụ thuộc TEMP cũ: [nguồn gốc](evidence/baseline-provenance.json). Cả bốn PDF có SHA-256 giống mẫu R30; kiểm inlineData đúng Base64 nguyên byte. [Đóng lỗi](evidence/r30-fix-closure.json), [mẫu PDF](evidence/fixture-manifest.json).

`pypdf 6.10.2 strict=True` đọc từ điển thật, kiểm NameObject `/` hoặc `/Nonempty` và giải cây một trang cho đủ bốn mẫu. Bộ đọc byte độc lập xác nhận tên có chuỗi rỗng. Oracle từ điển giữ nguyên hàm đọc R30, kiểm **54/54** kỳ vọng R29 bằng đúng sáu whitespace và mười delimiter PDF. Oracle pypdf ghi quan sát **117 PDF**, gồm bốn mẫu R30, và ghi rõ hành vi phục hồi; mở được PDF không tự chứng minh file đúng cú pháp. Chưa kiểm render hay chứng nhận toàn bộ PDF. [Oracle PDF](evidence/pdf-oracle-results.json), [oracle từ điển](evidence/pdf-dict-oracle-results.json), [oracle Name](evidence/pdf-name-oracle-results.json).

Thêm **28 ca biên** để kiểm tác động của việc nhận Name rỗng ở cả khóa và giá trị: scalar, từ điển/mảng lồng nhau, khóa rỗng, sáu whitespace hợp lệ; các trường hợp thiếu giá trị, khóa trùng, dấu `>`, `{`, `}` rời và sai loại `/Count` hoặc `/Type` vẫn bị chặn, không có inlineData. **28/28 đạt**. [Bộ kiểm](pdf-boundary-repro.mjs), [kết quả](evidence/pdf-boundary-results.json).

## 4. Trạng thái 14 nhóm

| Nhóm | Điều được kiểm | Ca gắn nhóm | Trạng thái |
|---|---|---:|---|
| R19-01 | Đọc file/ảnh/PDF an toàn | 414/414 | CLOSED_SOURCE |
| R19-02 | Kiểm tiêu chí và tự cộng điểm | 2/2 | CLOSED_SOURCE |
| R19-03 | Hash bản đã duyệt | 2/2 | CLOSED_SOURCE |
| R19-04 | AI cũ và phiên bản file | 5/5 | CLOSED_SOURCE |
| R19-05 | Chặn duyệt file lỗi | 5/5 | CLOSED_SOURCE |
| R19-06 | Bản đã xem và duyệt không lỗi thời | 68/68 | CLOSED_SOURCE |
| R19-07 | Đúng học viên/bài nộp trên modal | 2/2 | CLOSED_SOURCE |
| R19-08 | Đúng lớp/buổi/cột bài tập | 3/3 | CLOSED_SOURCE |
| R19-09 | Đúng yêu cầu và phản hồi lưu điểm | 277/277 | CLOSED_SOURCE |
| R19-10 | Đọc lại điểm/quyết định/nhận xét | 5/5 | CLOSED_SOURCE |
| R19-11 | Chỉ VERIFIED khi bản duyệt còn nguyên | 3/3 | CLOSED_SOURCE |
| R19-12 | Phản hồi giao diện về sai thứ tự | 2/2 | CLOSED_SOURCE |
| R19-13 | Lưu nháp nguyên khối và thứ tự bền | 22/22 | CLOSED_SOURCE |
| R19-14 | Dừng AI khi tải lỗi/chỉ chấm bài mới tải | 2/2 | CLOSED_SOURCE |

Mọi danh sách ID gắn nhóm được lấy theo R30 và đối chiếu với kết quả R31 vừa chạy; chi tiết từng ID ở [issue-status.json](evidence/issue-status.json). Không dùng trạng thái cũ thay kết quả mới. Không còn P1/P2 mở trong phạm vi này.

Riêng R19-09, worker giữ đúng hash R30. **277/277** ca gắn nhóm, **88/88** native worker, **88/88** oracle JS và **88/88** oracle Python mới đều đạt. Bộ Python tự quét ký tự, đọc cấu trúc yêu cầu, chuẩn hóa block string theo [đặc tả GraphQL](https://spec.graphql.org/September2025/#sec-String-Value), ghép biến được tham chiếu và trường phản hồi được chọn, rồi so với quan sát native; không import parser sản phẩm hoặc oracle JS. Không tái hiện VERIFIED sai trong ca âm tính đã kiểm; chưa xác minh schema LMS thật. [Kết quả Python](evidence/graphql-worker-oracle-results.json).

## 5. Cô lập và bảo toàn

Mọi lần thực thi sản phẩm, SQLite giả, TypeScript và build chạy trong các **bản sao vật lý tại TEMP**. Không dùng junction về workspace; không sao chép `.env`, `.env.local`, `.git`, DB/bài nộp thật hoặc `playwright-auth`. Môi trường tiến trình được lọc để không kế thừa mật khẩu/khóa. Rào Node chặn TCP/DNS/fetch, cho phép named pipe nội bộ; đây không phải tường lửa hệ điều hành. Không mở server, trình duyệt hoặc gọi LMS/Gemini thật. Việc tải công khai đặc tả Adobe phục vụ kiểm toán được thực hiện riêng, không qua sản phẩm. [Cô lập](evidence/isolation.json).

`ESBUILD_BINARY_PATH` trỏ tới bản sao `esbuild.exe` cùng hash ở TEMP ngắn. **21 lượt khởi chạy đầu** của chuỗi R22..R30/native bị Windows từ chối cwd quá dài (`WinError 267`), trước khi Node chạy. Chỉ rút ngắn tiền tố tên thư mục từ `compat` thành `x`, giữ đầy đủ nhãn vòng mà harness cũ yêu cầu; **21 cổng chạy lại đều đạt**. Hai lượt pdf-name/oracle chạy lại sau khi đưa baseline vào hồ sơ để gói tự chứa nguồn cũ. Giữ đủ mọi log và lỗi khởi chạy; không thay sản phẩm/harness lịch sử. [Ghi chú môi trường](evidence/harness-development-notes.md), [esbuild](evidence/esbuild-path-workaround.json).

Đối chiếu cuối **1287/1287 file ngoài R31** giữ nguyên; trong đó **1210/1210 file bảo vệ** gồm toàn bộ R12..R30 và `next-env.d.ts`. **57/57 src/scripts**, kế hoạch và các file gốc trong tập kiểm không đổi. Không sửa INDEX/LATEST hay checkbox. User yêu cầu chỉ ghi R31 nên quy tắc cập nhật kế hoạch không được áp dụng trong lượt kiểm toán này. [Bảo toàn](evidence/preservation-check.json).

SHA-256 `next-env.d.ts` tại workspace chính giữ đúng **B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000**. Next chỉ tái tạo file này trong TEMP khi build. Các nguồn ở cả bốn bản sao, kể cả bản đường dẫn dài không chạy được, khớp manifest; các harness lịch sử giữ nguyên byte. Tập kiểm bảo toàn không bao gồm toàn bộ node_modules/.next hoặc dữ liệu thật. [Đối chiếu snapshot](evidence/snapshot-source-check.json).

## 6. Tính độc lập và giới hạn

[verify-independent.mjs](verify-independent.mjs) giữ nguyên toàn bộ **819 ID, tiêu chí và kỳ vọng** R30, chỉ đổi đường dẫn đầu ra, tiền tố TEMP và metadata vòng. Kết quả mới của hai bộ trùng đủ 819/819. Bộ chính nạp thân hàm thật sau khi bỏ import/kiểu TypeScript; dùng SQLite thật trong bộ nhớ, file giả và mô phỏng DOM/API/AI/handler giao diện. Native media/worker import trực tiếp mô-đun TypeScript, không cắt thân hàm. Sharp/libwebp giải mã đầy đủ pixel các ca WebP kế thừa. [Nguồn gốc bộ kiểm](evidence/harness-provenance.json), [đối chiếu 819 ca](evidence/inherited-cases-check.json).

Rà nguồn xác nhận dev/start bind `127.0.0.1`, một persistent BrowserContext có khóa khởi tạo, thao tác save/download qua hàng đợi nối tiếp, đọc bài qua allowlist, ẩn danh văn bản gửi AI, tổng điểm tính bằng TypeScript, hash duyệt và cập nhật VERIFIED có điều kiện. Kiểm HTTP 200/201, đúng yêu cầu nghiệp vụ, đóng toast phụ và đọc lại vẫn được giữ. Hai entrypoint giao diện Giai đoạn 5 không tham chiếu ba biến bí mật bị cấm. Đây là rà luồng liên quan; không chứng nhận riêng tư/an toàn tuyệt đối hoặc bảo đảm AI luôn tuân thủ chỉ dẫn.

Chưa chạy trình duyệt/giao diện React thật, tài khoản thật, bài nộp/DB thật, Gemini thật, schema hay lưu/đọc lại LMS thật. Chưa kiểm mọi tài liệu PDF hoặc mọi hành vi người dùng. GO chỉ cho đúng nguồn đã ghi hash và phạm vi kiểm trên; không tự ký nghiệm thu vận hành hay chuyển Giai đoạn 6.

**Đã làm:** hoàn tất kiểm toán R31, đóng hai lỗi R30 với đối chứng đúng hash, chạy đủ chuỗi kiểm, tạo hồ sơ/bằng chứng và kiểm bảo toàn.

**Kết quả:** **GO cấp mã nguồn, 14/14 CLOSED_SOURCE**; không phát hiện lỗi mới trong phạm vi đã kiểm.

**Chưa kiểm tra:** vận hành trên giao diện, tài khoản, dữ liệu và LMS/Gemini thật.

**Việc tiếp theo:** Owner đọc báo cáo và ma trận; không có sửa nguồn bắt buộc từ R31. Nếu triển khai bước nghiệm thu vận hành, cần một phạm vi kiểm riêng do Owner cho phép. [FIX_PROMPT.vi.md](FIX_PROMPT.vi.md) ghi rõ không yêu cầu sửa thêm.
