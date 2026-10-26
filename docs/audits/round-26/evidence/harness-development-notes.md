# Các lượt phát triển bộ kiểm chứng R26

Giữ toàn bộ log, mã thoát và JSON theo attempt trong `commands.json`. Chỉ kết quả cuối của mỗi bộ được dùng cho phán quyết; không chuyển FAIL cũ thành PASS.

- Media attempt 1: 88/94. Sau đó đưa xuống dòng trước `trailer` trong literal PDF để marker thỏa chính điều kiện dò toàn cục; đồng thời dựng lại RIFF/chunk/byte đệm đúng cho các payload VP8 bị cắt. Media cuối attempt 2: **87/94**, bảy ca trượt. Không sửa điều kiện chấp nhận của sản phẩm.
- Bộ chính attempt 1: 492/502. Ca R26-04 ban đầu truyền `candidate.fileHash`, nhưng hợp đồng `HomeworkGradeCandidateInput` không có trường này. Đây là giả định sai của bộ thử, không phải lỗi sản phẩm. Đã sửa thành đổi fileHash trong SQLite khi đang chờ AI; giữ yêu cầu kết quả AI cũ không được ghi đè. Ca này đạt ở mọi lượt sau.
- Bộ chính attempt 2: 493/502. Thêm hai ca operation giả bên trong chuỗi: attempt 3 **493/504**, xác nhận hai VERIFIED sai mới.
- Thêm kiểm tra trigger thất bại ở UPDATE VERIFIED cuối và năm đối chứng R20/R21: attempt 4 **498/510**. Một đối chứng mapping mới dùng nhầm colIndex=1 với DOM chỉ có cột buổi 1. Đã dùng đúng mảng columns nguyên bản R21 (L1 index 0, L2 index 1), giữ nguyên mọi kỳ vọng hành vi. Bộ chính cuối attempt 5: **499/510**; 11 ca trượt đều có xác nhận native tương ứng.
- Native worker attempt 1 dừng trước khi tạo kết quả vì DB giả từ R25 đã khóa SUB1 cho lớp R25, còn bộ mới dùng lớp R26. Rào toàn vẹn sản phẩm chặn đúng. Đã chuyển native R26 sang một thư mục TEMP/SQLite mới cho mỗi lần chạy, không xóa hoặc thay bản ghi cũ để vượt rào. Attempt 2 **50/52**; thêm hai ca operation giả, attempt 3 cuối **50/54**.
- pypdf được chạy hai lần: lần sau bổ sung thông tin Root có khai báo trong xref hay không trước bước phục hồi. Không thay mẫu/điều kiện sản phẩm. Một số mẫu thiếu xref được pypdf tự tìm lại object dù strict=True; báo cáo giữ rõ giới hạn này.

Nguồn sản phẩm, kế hoạch, quy tắc và hồ sơ R12–R25 gốc giữ nguyên trong mọi lượt. Các thay đổi trên chỉ ở công cụ kiểm toán R26 và bản sao TEMP.
