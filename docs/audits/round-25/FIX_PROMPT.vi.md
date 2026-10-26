# Yêu cầu sửa sau AUDIT-R25

Đây là đề nghị cho lượt triển khai tiếp theo, không phải thay đổi đã thực hiện trong kiểm toán R25.

```text
Sửa tối thiểu hai nhóm còn mở của Phase 5 theo docs/audits/round-25/REPORT.vi.md.
Đọc MINDX_AUTOMATION_PLAN.md và quy tắc dự án trước; kiểm tra thay đổi chưa commit, giữ điểm khôi phục phù hợp. Không ghi đè công việc có sẵn của Owner hoặc sửa các bộ kiểm toán lịch sử.

1. R19-09, grade-worker.ts:
- Kiểm riêng kiểu và giá trị của từng trường nghiệp vụ có mặt trong response. Không dùng ?? để cho một trường đúng che ID/quyết định/feedback khác sai hoặc null.
- decision/status phải là chuỗi hợp lệ; không ép mảng/object thành chuỗi.
- Với request input, kiểm khóa scalar được nhận diện như score/submissionId trước khi đệ quy container; không lấy trường ở vị trí khác để bù cho khóa scalar sai kiểu.
- Response phải khớp đúng trường/alias đã chọn ở mọi nhánh, kể cả nhánh không đối số; bỏ ngoại lệ saveGrade ngoài trường chọn.
- Giữ hỗ trợ literal, biến đổi tên, nested input hợp lệ, HTTP 200/201, đọc lại DOM và kiểm hash trước VERIFIED. Biến không được tham chiếu không được cung cấp bằng chứng.

2. R19-01, media-reader.ts:
- Dùng giải mã ảnh thực tế với giới hạn tài nguyên trước khi tạo inlineData; bỏ suy đoán ảnh hợp lệ bằng entropy/độ dài. Giữ nguyên bytes gốc và nhận đúng các WebP nhỏ hợp lệ.
- Lấy Root trực tiếp từ đúng dictionary trailer PDF; bỏ qua chuỗi/stream và Root trong dictionary lồng. Giữ đối chiếu object:generation và cây Pages/Kids/Parent.

Kiểm tra trên snapshot TEMP cô lập có đủ tiền tố an toàn, không dùng tài khoản/DB/bài nộp thật. Giữ nguyên next-env.d.ts gốc và lịch sử R12-R25.
Yêu cầu: bộ R25 344/344, native media R25 25/25, native worker 9/9; R24 nguyên bản 230/230 và native R24 8/8; giữ các kiểm tra hợp lệ và hồi quy đã đóng. R20/R16 có lệch hợp đồng được ghi rõ trong REPORT, không sửa kỳ vọng lịch sử để tạo PASS. Chạy Phase 4/5, TypeScript và build.
Trả diff, hash bản nguồn, log/mã thoát và giới hạn chưa kiểm. Không tự đánh dấu 14/14 hoặc nghiệm thu Phase 5 trước kiểm toán độc lập mới.
```
