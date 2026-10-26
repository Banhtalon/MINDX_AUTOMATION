# Yêu cầu sửa sau AUDIT-R28

**NO-GO cấp mã nguồn: 12/14 nhóm CLOSED_SOURCE.** Toàn bộ 12 lỗi R27 đã đóng. Còn hai nhóm **P2**: R19-01 (6 PDF sai cấu trúc được nhận) và R19-09 (3 block string hợp lệ bị từ chối). Không tái hiện các đường VERIFIED sai P1 của R27 trong phạm vi đã kiểm.

Chuyển nội dung dưới đây cho bên triển khai:

```text
Sửa tối thiểu hai nhóm còn mở theo docs/audits/round-28/REPORT.vi.md và evidence/fixture-manifest.json.

Đọc AGENTS.md và MINDX_AUTOMATION_PLAN.md. Kiểm tra thay đổi chưa commit và giữ điểm khôi phục. Không sửa hồ sơ round-12 đến round-28 hoặc thay kỳ vọng để làm xanh. Giữ next-env.d.ts trong workspace chính đúng SHA-256 B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000.

Chỉ chạy sản phẩm, SQLite giả, kiểm thử, TypeScript và build trong bản sao TEMP cô lập. Không mang mật khẩu, hồ sơ đăng nhập, DB, bài nộp hoặc tài khoản thật vào bản sao. Không cài lại môi trường hoặc đổi cấu trúc dự án.

1. R19-01, P2 — src/lib/file-parsers/media-reader.ts:1268–1273 và 1440–1443.

Các regex /Length và /Count lấy phần số nguyên đầu chuỗi thay vì kiểm đúng kiểu và toàn bộ giá trị. /Length 8.5 và 8.0 đều bị đọc thành 8; /Count 1.5 và 1.0 đều bị đọc thành 1. Đây là giá trị real, không phải integer. Hai mẫu /Length 8/foo và /Count 1/foo còn có khóa /foo thiếu giá trị nhưng vẫn được nhận.

Sáu mẫu sau phải PARSE_ERROR và không có inlineData:
- R28-01-pdf-length-direct-fraction
- R28-01-pdf-length-direct-real-integral
- R28-01-pdf-length-direct-junk
- R28-01-pdf-count-1_5
- R28-01-pdf-count-1_0
- R28-01-pdf-count-1_foo

Đọc giá trị số theo token đầy đủ và đúng kiểu integer; không cắt phần thập phân. Xác nhận cấu trúc cặp khóa/giá trị ở phần từ điển liên quan, chặn khóa thiếu giá trị. /foo là token Name riêng, không phải phần số 8/1: chỉ thêm ranh giới số sẽ chưa chặn hai mẫu từ điển thiếu giá trị này. Không cấm mọi khóa bổ sung: length-extra-key-control và count-extra-key-control có /Other đầy đủ phải tiếp tục PARSED.

Giữ nguyên ranh giới stream theo số byte Length, tham chiếu Length đúng generation, kiểm tra cuối stream/endobj, mọi Kids phải là reference, Parent, khóa trùng, chu kỳ và Count khớp số Page. Giữ control stream rỗng /Length 0, LF/CRLF/CR, Length reference trước/sau, generation khác 0, cây Page nhiều tầng. Không sửa bằng cách chấp nhận nhầm kiểu hoặc phục hồi PDF hỏng rồi cho PARSED.

2. R19-09, P2 — src/lib/playwright/grade-worker.ts:451–465.

Lexer đã giữ block string thành một token nhưng dùng nguyên phần chữ thô, thiếu thuật toán BlockStringValue của GraphQL: chuẩn hóa xuống dòng, bỏ thụt đầu dòng chung và dòng trắng ở hai đầu. Ba ca R28-09-block-two-lines, block-two-lines-crlf, block-tabs có giá trị thực APPROVED\nFEEDBACK khớp bản duyệt nhưng worker từ chối request, kết quả FAILED sau một lần bấm Save trong mô phỏng.

Áp dụng BlockStringValue khi tạo token STRING từ block string; giữ xử lý dấu nháy kép đơn bên trong và escape \""". Không xử lý indent bằng cách nới so sánh nhận xét hoặc chấp nhận mọi whitespace. Không đổi cách xác nhận bản giáo viên duyệt. Tham khảo thuật toán chuẩn được dẫn trong REPORT.

Giữ toàn bộ bảo vệ loại ENUM/STRING, biến thực sự được tham chiếu, scalar/object/array, chọn đúng operation/root/alias, HTTP 200/201, GraphQL errors, nội dung phản hồi, đọc lại điểm/quyết định/nhận xét và cập nhật VERIFIED có điều kiện theo hash bản duyệt. Không bỏ rào để làm xanh test cũ có response sai trường.

3. Bằng chứng bắt buộc trên đúng nguồn cuối:
- R28: 737/737; native media 163/163; native worker 64/64. Giữ nguyên cả 662 ca R27 và 75 ca R28.
- R27: 662/662, native media 120/120, native worker 32/32.
- R26: 510/510, native media 94/94, native worker 54/54.
- R25: 344/344, native media 25/25, native worker 9/9.
- R24 230/230; R23 116/116; R22 53/53; native R24 8/8.
- Phase 4/5, tsc --noEmit --incremental false trước/sau next build --webpack phải đạt.
- Chạy các bộ lịch sử nguyên bản, giữ nguyên kết quả thô và giải thích lệch hợp đồng; giữ đối chứng tương thích kế thừa đạt. Không biến R14/R18 bị chặn bởi điều kiện ghi hồ sơ một lần hoặc R15 tái hiện lỗi lịch sử thành PASS.

Lệnh chính chạy từ snapshot TEMP theo audit-runner.py R28, không chạy ở workspace chính:
node docs/audits/round-28/verify-independent.mjs
node node_modules/tsx/dist/cli.mjs docs/audits/round-28/native-media-repro.mjs
node node_modules/tsx/dist/cli.mjs docs/audits/round-28/native-worker-repro.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/next/dist/bin/next build --webpack
node node_modules/typescript/bin/tsc --noEmit --incremental false

Trả diff, danh sách file sửa, SHA-256 nguồn cuối, lệnh/mã thoát/log và phần chưa kiểm thực tế. Chỉ đề nghị GO cấp mã nguồn sau vòng kiểm toán mới; không tự ký nghiệm thu LMS thật từ mô phỏng.
```
