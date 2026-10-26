# Ghi chú môi trường và bộ kiểm R31

- 21 lần khởi chạy chuỗi lịch sử thất bại với WinError 267 do cwd dài hơn giới hạn Windows. Node chưa chạy; log trống cùng launch-error JSON được giữ. Không phân loại là lỗi sản phẩm.
- Rút `compat` thành `x` trong tên bản sao TEMP, giữ đủ các chuỗi `mindx-roundNN-` cho assertion cũ. Sao chép vật lý mới và chạy lại 21/21 cổng đạt. Không sửa file trong R12..R30.
- ESBUILD_BINARY_PATH luôn trỏ bản sao cùng SHA-256 tại đường dẫn TEMP ngắn; không cài lại thư viện.
- pdf-name lần 1 dùng nguồn TEMP R30 đúng hash. Lần 2 chuyển sang bản nguồn cũ cùng hash lưu trong R31/evidence/baseline để tái hiện độc lập với tuổi thọ TEMP cũ; 4/4 và oracle 4/4 đều đạt ở hai lượt.
- Oracle pypdf lần này quan sát 117 PDF thay vì con số 113 trong báo cáo R30: R31 dùng corpus native cuối cùng có thêm bốn mẫu Name R30. Số kỳ vọng từ điển R29 vẫn 54/54. Không tái sử dụng kết quả pypdf cũ.
- Tiện ích đọc đặc tả ban đầu không tìm thấy chuỗi vì giới hạn trang và chữ `empty` bị xuống dòng thành `emp` + `ty` trong phần text PDF. Đã xác minh lại trên trang PDF 25 bằng so sánh bỏ whitespace; không thay đổi giả định kiểm thử hoặc sản phẩm.
- Một lệnh soạn metadata bằng Python -c lỗi dấu nháy trong PowerShell; thay bằng apply_patch. Một số lần đọc metadata bằng Python gặp bảng mã mặc định Windows; đọc lại UTF-8. Đây là tiện ích hồ sơ, không phải lượt thực thi sản phẩm; không che lỗi kiểm thử.
- Không sửa MINDX_AUTOMATION_PLAN.md vì Owner chỉ cho ghi docs/audits/round-31/. Checklist ở kế hoạch là lịch sử, báo cáo R31 là quyết định nguồn của lượt này.
