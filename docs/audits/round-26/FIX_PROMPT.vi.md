# Yêu cầu sửa sau AUDIT-R26

Phán quyết hiện tại: **NO-GO Giai đoạn 5**, còn R19-09 (P1) và R19-01 (P2). Đây là đầu việc cho lượt triển khai tiếp theo; kiểm toán R26 chưa sửa sản phẩm.

Có thể chuyển nguyên nội dung dưới đây cho bên triển khai:

```text
Sửa tối thiểu hai nhóm còn mở của Giai đoạn 5 theo docs/audits/round-26/REPORT.vi.md.

Đọc MINDX_AUTOMATION_PLAN.md và quy tắc dự án; kiểm tra công việc chưa commit, giữ điểm khôi phục và không ghi đè công việc có sẵn. Không sửa các bộ kiểm toán lịch sử để làm xanh kết quả. Mọi chạy thử, verifier, TypeScript, build và SQLite trigger phải ở bản sao cô lập trong TEMP; không dùng tài khoản, DB, bài nộp hoặc dịch vụ thật. Giữ next-env.d.ts gốc đúng SHA-256 B8B3A344484B959AF5E4E3FC1A1609DAC3CB9ECE0CDEB6C145BE29BC4C491000.

1. Ưu tiên R19-09 — src/lib/playwright/grade-worker.ts, requestPredicate, vùng dòng 434–680.

Nguyên nhân: opRegex dò operation nằm trong chuỗi và có thể lấy biến chỉ được nhắc trong chuỗi làm bằng chứng. R26-09-quoted-operation-decoy và R26-09-quoted-operation-preview-decoy thực sự gọi deleteAttachment/previewHomework, nhưng đoạn saveHomeworkGrade trong tham số note khiến worker ghi VERIFIED. Bộ native import trực tiếp xác nhận cả hai. Đây là hợp đồng giả để kiểm rào, không phải khẳng định schema LMS thật có các trường này.

Cách sửa: phân tích GraphQL theo cấu trúc có nhận biết chuỗi/comment; chọn đúng operation đang thực thi, root field/alias và đối số của nó. Chỉ đối chiếu biến được tham chiếu thực sự trong đối số đã chọn. Không để text trong chuỗi tạo operation hoặc khóa nghiệp vụ. Chọn cách nhỏ nhất bảo đảm đúng; không thêm một regex đoán riêng cho từng mẫu.

Giữ literal hợp lệ, biến đổi tên, nested input, # trong chuỗi và dấu nháy thoát. Sửa luôn R26-09-literal-brace-open / literal-close-brace: dấu { hoặc } trong nhận xét hợp lệ không được làm request bị từ chối. Ca dùng cùng nội dung qua biến đang đạt.

Giữ toàn bộ sửa đã đạt ở R25: kiểm từng khóa scalar trước khi đi vào object con; từ chối null/object/array sai kiểu; kiểm độc lập mọi trường response đồng nghĩa; response phải đúng trường/alias đã chọn; decision/status phải là chuỗi hợp lệ. Giữ HTTP 200/201, đọc lại điểm/quyết định/nhận xét và kiểm hash/CAS cuối trước VERIFIED.

2. R19-01 — src/lib/file-parsers/media-reader.ts.

WebP: ba ca differential-gradient-false-truncate2, differential-gradient-false-truncate7, differential-noise-false-truncate7 cắt đuôi VP8 từ ảnh hợp lệ. RIFF/chunk/byte đệm đã tính đúng; sharp giải mã pixel thất bại nhưng sản phẩm vẫn PARSED + inlineData. Vùng kiểm VP8 dòng 386–700 còn chưa đủ. Dùng giải mã đáng tin cậy có giới hạn tài nguyên, hoặc hoàn thiện bộ giải mã hiện tại và chứng minh bằng đối chứng. Không đổi sang ngưỡng byte/entropy và không giả định chỉ thêm EOF là đủ.

PDF: bộ dò object/trailer toàn cục vẫn nhận marker bên trong literal string, chọn Root đầu khi có khóa trùng và cho Page thiếu Parent đi qua. Xử lý token/object/trailer bên ngoài chuỗi, comment và stream ngay từ đầu; xử lý stream theo cấu trúc/độ dài. Từ chối khóa điều hướng trùng/xung đột; node con cần Parent đúng; giữ kiểm số object và generation cho Root/Pages/Kids/Parent. Không tìm lại catalog từ văn bản giả khi Root thật thiếu.

Bảy ca R26-01 trượt phải PARSE_ERROR và không có inlineData; file lỗi không tự chấm 0 hoặc tự chọn REDO. Giữ 48 ảnh mới hợp lệ và toàn bộ đối chứng media cũ, gồm WebP nhỏ/alpha/VP8X/VP8L, PNG/JPEG và PDF generation hợp lệ.

3. Kiểm chứng sau sửa trên đúng snapshot nguồn cuối.

- R26 chính: 510/510.
- R26 native media: 94/94; native worker: 54/54.
- R25 nguyên bản: 344/344; native media 25/25; native worker 9/9.
- R24 230/230; R23 116/116; R22 53/53; native R24 8/8.
- Phase 4/5, tsc --noEmit --incremental false trước và sau build, next build --webpack đều đạt.
- R20/R21 nguyên bản hiện 140/145 và 45/49 vì chín lệch hợp đồng được ghi rõ trong REPORT. Không sửa lịch sử hay bỏ kiểm tra chặt để lấy lại PASS. Giữ bốn đối chứng snapshot duyệt R24 và năm đối chứng response đúng trường R26 đạt; báo riêng kết quả thô và kết quả tương thích.

Lệnh kiểm chứng chạy từ thư mục snapshot TEMP (các kiểm tra lịch sử yêu cầu tiền tố đường dẫn tương ứng; xem audit-runner.py):
node docs/audits/round-26/verify-independent.mjs
node node_modules/tsx/dist/cli.mjs docs/audits/round-26/native-media-repro.mjs
node node_modules/tsx/dist/cli.mjs docs/audits/round-26/native-worker-repro.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/next/dist/bin/next build --webpack
node node_modules/typescript/bin/tsc --noEmit --incremental false

Trả danh sách file sửa, diff, hash nguồn, log/mã thoát và phần chưa kiểm thực tế. Không tự kết luận 14/14 hoặc nghiệm thu LMS thật trước vòng kiểm toán độc lập mới.
```
